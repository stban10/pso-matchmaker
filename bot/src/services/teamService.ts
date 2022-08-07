import { BaseGuildTextChannel, ButtonInteraction, Client, CommandInteraction, GuildMember, Interaction, MessageOptions, TextChannel, User } from "discord.js";
import { DeleteResult } from "mongodb";
import { UpdateWriteOpResult } from "mongoose";
import { MAX_LINEUP_NAME_LENGTH, MAX_TEAM_NAME_LENGTH } from "../constants";
import { Bans, IBan, ILineup, IRole, IRoleBench, ITeam, IUser, Lineup, Team } from "../mongoSchema";
import { handle } from "../utils";
import { interactionUtils } from "./interactionUtils";
import { matchmakingService } from "./matchmakingService";
import { statsService } from "./statsService";

export const ROLE_GOAL_KEEPER = 0
export const ROLE_ATTACKER = 1
export const ROLE_DEFENDER = 2
export const ROLE_MIDFIELDER = 3

export const ROLE_NAME_ANY = "any"

export const LINEUP_VISIBILITY_TEAM = 'TEAM'
export const LINEUP_VISIBILITY_PUBLIC = 'PUBLIC'

export const LINEUP_TYPE_TEAM = 'TEAM'
export const LINEUP_TYPE_MIX = 'MIX'
export const LINEUP_TYPE_CAPTAINS = 'CAPTAINS'

const GK = { name: '🥅 GK', type: ROLE_GOAL_KEEPER }
const LW = { name: 'LW', type: ROLE_ATTACKER }
const CF = { name: 'CF', type: ROLE_ATTACKER }
const RW = { name: 'RW', type: ROLE_ATTACKER }
const LM = { name: 'LM', type: ROLE_MIDFIELDER }
const LCM = { name: 'LCM', type: ROLE_MIDFIELDER }
const CM = { name: 'CM', type: ROLE_MIDFIELDER }
const RCM = { name: 'RCM', type: ROLE_MIDFIELDER }
const RM = { name: 'RM', type: ROLE_MIDFIELDER }
const LB = { name: 'LB', type: ROLE_DEFENDER }
const LCB = { name: 'LCB', type: ROLE_DEFENDER }
const CB = { name: 'CB', type: ROLE_DEFENDER }
const RCB = { name: 'RCB', type: ROLE_DEFENDER }
const RB = { name: 'RB', type: ROLE_DEFENDER }

function role(role: any, pos: number) {
    return { ...role, pos }
}

const DEFAULT_PLAYER_ROLES = new Map([
    [1, [role(CF, 0)]],
    [2, [role(CF, 0), role(GK, 0)]],
    [3, [role(LM, 0), role(RM, 2), role(GK, 1)]],
    [4, [role(CF, 1), role(LB, 0), role(RB, 2), role(GK, 1)]],
    [5, [role(CF, 1), role(LB, 0), role(CB, 1), role(RB, 2), role(GK, 1)]],
    [6, [role(LW, 0), role(RW, 2), role(CM, 1), role(LB, 0), role(RB, 2), role(GK, 1)]],
    [7, [role(LW, 0), role(RW, 2), role(CM, 1), role(LB, 0), role(CB, 1), role(RB, 2), role(GK, 1)]],
    [8, [role(LW, 0), role(CF, 1), role(RW, 2), role(CM, 1), role(LB, 0), role(CB, 1), role(RB, 2), role(GK, 1)]],
    [9, [role(LW, 0), role(CF, 2), role(RW, 4), role(LCM, 1), role(RCM, 3), role(LB, 0), role(CB, 2), role(RB, 4), role(GK, 2)]],
    [10, [role(LW, 0), role(CF, 2), role(RW, 4), role(LCM, 1), role(RCM, 3), role(LB, 0), role(LCB, 1), role(RCB, 3), role(RB, 4), role(GK, 2)]],
    [11, [role(LW, 0), role(CF, 2), role(RW, 4), role(LM, 0), role(CM, 2), role(RM, 4), role(LB, 0), role(LCB, 1), role(RCB, 3), role(RB, 4), role(GK, 2)]]
])

class TeamService {
    validateTeamName(name: string): boolean {
        const filteredName = this.removeSpecialCharacters(name)
        return filteredName.length > 0 && filteredName.length <= MAX_TEAM_NAME_LENGTH
    }

    validateLineupName(name: string): boolean {
        return name.length > 0 && name.length <= MAX_LINEUP_NAME_LENGTH
    }

    formatTeamName(lineup: ILineup, filterName: boolean = false, includeRating: boolean = false): string {
        let name = `**${lineup.team.name}`
        if (lineup.name) {
            name += ` *(${lineup.name})*`
        }
        name += `**`
        if (includeRating) {
            name += ` (${lineup.team.rating})`
        }

        return filterName ? this.removeSpecialCharacters(name) : name
    }

    hasGkSigned(lineup: ILineup): boolean {
        return lineup.roles.find(role => role.name.includes('GK'))?.user != null;
    }

    async deleteTeam(guildId: string): Promise<DeleteResult> {
        return Team.deleteOne({ guildId })
    }

    async findTeamByGuildId(guildId: string): Promise<ITeam | null> {
        return Team.findOne({ guildId })
    }

    async findTeamByRegionAndName(region: string, name: string): Promise<ITeam | null> {
        return Team.findOne({ region, name })
    }

    async updateTeamNameByGuildId(guildId: string, name: string): Promise<void> {
        await Promise.all([Team.updateOne({ guildId }, { name }), Lineup.updateMany({ 'team.guildId': guildId }, { 'team.name': name })])
    }

    async updateTeamLastMatchDateByGuildId(guildId: string, date: Date): Promise<UpdateWriteOpResult> {
        return Team.updateOne({ guildId }, { lastMatchDate: date })
    }

    async updateTeamRating(guildId: string, rating: number): Promise<void> {
        await Promise.all([
            Team.updateOne({ guildId }, { rating }),
            Lineup.updateMany({ 'team.guildId': guildId }, { 'team.rating': rating })
        ])
    }

    async updateLineupNameByChannelId(channelId: string, name?: string): Promise<UpdateWriteOpResult> {
        return Lineup.updateOne({ channelId }, { name })
    }

    async updateTeamRegionByGuildId(guildId: string, region: string): Promise<void> {
        await Promise.all([
            Team.updateOne({ guildId }, { region }),
            Lineup.updateMany({ 'team.guildId': guildId }, { 'team.region': region })
        ])
    }

    async deleteLineup(channelId: string): Promise<DeleteResult> {
        return Lineup.deleteOne({ channelId })
    }

    async retrieveLineup(channelId: string): Promise<ILineup | null> {
        return Lineup.findOne({ channelId })
    }

    async upsertLineup(lineup: ILineup): Promise<UpdateWriteOpResult> {
        return Lineup.updateOne(
            { 'channelId': lineup.channelId },
            {
                size: lineup.size,
                roles: lineup.roles,
                bench: lineup.bench,
                name: lineup.name,
                autoSearch: lineup.autoSearch,
                allowRanked: lineup.allowRanked,
                team: lineup.team,
                type: lineup.type,
                visibility: lineup.visibility,
                lastMatchDate: lineup.lastMatchDate
            } as ILineup,
            { upsert: true }
        )
    }

    async clearLineup(channelId: string, lineupsToClear = [1], clearBench: boolean = true): Promise<ILineup | null> {
        return Lineup.findOneAndUpdate(
            {
                channelId
            },
            {
                "$set": clearBench ?
                    {
                        "roles.$[i].user": null,
                        "bench": []
                    } :
                    {
                        "roles.$[i].user": null
                    }
            },
            {
                arrayFilters: [{ "i.lineupNumber": { $in: lineupsToClear } }],
                new: true
            }
        )
    }

    async startPicking(channelId: string): Promise<ILineup | null> {
        return Lineup.findOneAndUpdate({ channelId }, { isPicking: true }, { new: true })
    }

    async stopPicking(channelId: string): Promise<ILineup | null> {
        return Lineup.findOneAndUpdate({ channelId }, { isPicking: false }, { new: true })
    }

    async deleteLineupsByGuildId(guildId: string): Promise<DeleteResult> {
        return Lineup.deleteMany({ 'team.guildId': guildId })
    }

    async removeUserFromAllLineups(userId: string): Promise<UpdateWriteOpResult> {
        return Lineup.updateMany(
            {
                "$or": [
                    { 'roles.user.id': userId },
                    { 'bench': { "$elemMatch": { 'user.id': userId } } }
                ]
            },
            {
                "$set": {
                    "roles.$[i].user": null
                },
                "$pull": {
                    "bench": {
                        "user.id": userId
                    }
                }
            },
            {
                arrayFilters: [{ "i.user.id": userId }],
                new: true
            }
        )
    }

    async removeUserFromLineupsByChannelIds(userId: string, channelIds: string[]): Promise<UpdateWriteOpResult> {
        return Lineup.updateMany(
            {
                'channelId': { $in: channelIds }
            },
            {
                "$set": {
                    "roles.$[i].user": null
                },
                "$pull": {
                    "bench": {
                        "user.id": userId
                    }
                }
            },
            {
                arrayFilters: [{ "i.user.id": userId }],
                new: true
            }
        )
    }

    async removeUserFromLineup(channelId: string, userId: string): Promise<ILineup | null> {
        return Lineup.findOneAndUpdate(
            {
                channelId
            },
            {
                "$set": {
                    "roles.$[i].user": null
                },
                "$pull": {
                    "bench": {
                        "user.id": userId
                    }
                }
            },
            {
                arrayFilters: [{ "i.user.id": userId }],
                new: true
            }
        )
    }

    async removeUserFromLineupBench(channelId: string, userId: string): Promise<ILineup | null> {
        return Lineup.findOneAndUpdate(
            { channelId },
            {
                "$pull": {
                    "bench": {
                        "user.id": userId
                    }
                }
            },
            {
                new: true
            }
        )
    }

    async moveUserFromBenchToLineup(channelId: string, user: IUser, role: IRole): Promise<ILineup | null> {
        return Lineup.findOneAndUpdate(
            {
                channelId
            },
            {
                "$set": {
                    "roles.$[i].user": user
                },
                "$pull": {
                    "bench": {
                        "user.id": user.id
                    }
                }
            },
            {
                arrayFilters: [{ "i.lineupNumber": role.lineupNumber, "i.name": role.name }],
                new: true
            }
        )
    }

    async addUserToLineup(channelId: string, roleName: string, user: IUser, selectedLineup = 1): Promise<ILineup | null> {
        return Lineup.findOneAndUpdate(
            {
                channelId
            },
            {
                "$set": {
                    "roles.$[i].user": user
                }
            },
            {
                arrayFilters: [{ "i.lineupNumber": selectedLineup, "i.name": roleName }],
                new: true
            }
        )
    }

    async addUserToLineupBench(channelId: string, user: IUser, roles: IRole[]): Promise<ILineup | null> {
        return Lineup.findOneAndUpdate(
            {
                channelId
            },
            {
                "$push": {
                    "bench": { user, roles } as IRoleBench
                }
            },
            {
                new: true
            }
        )
    }

    async clearRoleFromLineup(channelId: string, roleName: string, selectedLineup = 1): Promise<ILineup | null> {
        return Lineup.findOneAndUpdate(
            {
                channelId
            },
            {
                "$set": {
                    "roles.$[i].user": null
                }
            },
            {
                arrayFilters: [{ "i.lineupNumber": selectedLineup, "i.name": roleName }],
                new: true
            }
        )
    }

    async joinBench(user: User, lineup: ILineup, rolesNames: string[], lineupNumber: number = 1, member?: GuildMember): Promise<ILineup | null> {
        await this.removeUserFromLineupBench(lineup.channelId, user.id)
        const userToAdd = {
            id: user.id,
            name: user.username,
            mention: user.toString(),
            emoji: statsService.getLevelEmojiFromMember(member as GuildMember)
        }
        const benchRoles = rolesNames.map(roleName => (
            {
                name: roleName,
                type: 0,
                lineupNumber,
                pos: 0,
                user: userToAdd
            } as IRole
        ))
        return this.addUserToLineupBench(
            lineup.channelId,
            userToAdd,
            benchRoles
        )
    }

    async leaveLineup(interaction: CommandInteraction | ButtonInteraction, channel: BaseGuildTextChannel, lineup: ILineup): Promise<boolean> {
        let roleLeft = lineup.roles.find(role => role.user?.id === interaction.user.id)
        let benchLeft = lineup.bench.find(role => role.user.id === interaction.user.id)

        if (!roleLeft && !benchLeft) {
            await interaction.reply({ content: `⛔ You are not in the lineup`, ephemeral: true })
            return false
        }

        let newLineup = await this.removeUserFromLineup(lineup.channelId, interaction.user.id) as ILineup
        await matchmakingService.removeUserFromLineupQueue(lineup.channelId, interaction.user.id)

        let description = benchLeft ?
            `:outbox_tray: ${interaction.user} left the bench`
            : `:outbox_tray: ${interaction.user} left the ${newLineup.isMixOrCaptains() ? 'queue !' : `**${roleLeft?.name}** position`}`

        const autoSearchResult = await matchmakingService.checkIfAutoSearch(interaction.client, interaction.user, newLineup)
        if (autoSearchResult.leftQueue) {
            description += `\nYou are no longer searching for a team.`
        }
        if (autoSearchResult.cancelledChallenge) {
            description += `\nThe challenge request has been cancelled.`
        }

        const benchUserToTransfer = this.getBenchUserToTransfer(newLineup, roleLeft)
        if (benchUserToTransfer !== null) {
            newLineup = await this.moveUserFromBenchToLineup(interaction.channelId, benchUserToTransfer, roleLeft!!) as ILineup
            description += `\n:inbox_tray: ${benchUserToTransfer.mention} came off the bench and joined the **${roleLeft?.name}** position.`
        }

        let reply = await interactionUtils.createReplyForLineup(interaction as Interaction, newLineup, autoSearchResult.updatedLineupQueue) as MessageOptions
        const embed = interactionUtils.createInformationEmbed(interaction.user, description)
        reply.embeds = (reply.embeds || []).concat(embed)
        await channel.send(reply)
        return true
    }

    async notifyChannelForUserLeaving(client: Client, user: User, channelId: string, description: string): Promise<void> {
        const [channel] = await handle(client.channels.fetch(channelId))
        if (channel instanceof TextChannel) {
            const lineup = await this.retrieveLineup(channelId)
            if (lineup === null) {
                return
            }

            const autoSearchResult = await matchmakingService.checkIfAutoSearch(client, user, lineup)
            if (autoSearchResult.leftQueue) {
                description += `\nYou are no longer searching for a team.`
            }
            if (autoSearchResult.cancelledChallenge) {
                description += `\nThe challenge request has been cancelled.`
            }

            const embed = interactionUtils.createInformationEmbed(user, description)
            await channel.send({ embeds: [embed] })
        }
    }

    async findAllLineupChannelIdsByUserId(userId: string, excludedChannelIds: string[] = []): Promise<string[]> {
        let res = await Lineup.aggregate([
            {
                $match: {
                    channelId: { $nin: excludedChannelIds },
                    $or: [
                        {
                            roles: {
                                $elemMatch: { 'user.id': userId }
                            }
                        },
                        {
                            bench: {
                                $elemMatch: { 'user.id': userId }
                            }
                        }
                    ]
                }
            },
            {
                $group: {
                    _id: null,
                    channelIds: {
                        $addToSet: '$$ROOT.channelId'
                    }
                }
            }
        ])

        if (res.length > 0) {
            return res[0].channelIds
        }

        return []
    }

    async findAllLineupsByUserId(userId: string): Promise<ILineup[]> {
        return Lineup.find(
            {
                $or: [
                    {
                        roles: {
                            $elemMatch: { 'user.id': userId }
                        }
                    },
                    {
                        bench: {
                            $elemMatch: { 'user.id': userId }
                        }
                    }
                ]
            }
        )
    }

    async findChannelIdsFromGuildIdAndUserId(guildId: string, userId: string): Promise<string[]> {
        const res = await Lineup.aggregate([
            {
                $match: {
                    'team.guildId': guildId,
                    roles: {
                        $elemMatch: { 'user.id': userId }
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    channelIds: {
                        $addToSet: '$$ROOT.channelId'
                    }
                }
            }
        ])

        if (res.length > 0) {
            return res[0].channelIds
        }

        return []
    }

    async findAllChannelIdToNotify(region: string, channelId: string, lineupSize: number): Promise<string[]> {
        const res = await Lineup.aggregate([
            {
                $match: {
                    'team.region': region,
                    type: { $nin: [LINEUP_TYPE_MIX, LINEUP_TYPE_CAPTAINS] },
                    channelId: { $ne: channelId },
                    size: lineupSize
                }
            },
            {
                $group: {
                    _id: null,
                    channelIds: {
                        $addToSet: '$$ROOT.channelId'
                    }
                }
            }
        ])

        if (res.length > 0) {
            return res[0].channelIds
        }

        return []
    }

    createLineup(channelId: string, size: number, name: string = '', autoSearch: boolean, allowRanked: boolean, team: ITeam, type: string, visibility: string): ILineup {
        const defaultRoles = DEFAULT_PLAYER_ROLES.get(size)!

        let roles = defaultRoles.map(obj => ({ ...obj, lineupNumber: 1 }))
        if (type === LINEUP_TYPE_MIX) {
            roles = roles.concat(defaultRoles.map(obj => ({ ...obj, lineupNumber: 2 })))
        } else if (type === LINEUP_TYPE_CAPTAINS) {
            roles = []
            let i = 1
            while (i < size) {
                roles.push({ name: i, lineupNumber: 1, type: ROLE_ATTACKER, pos: 0 })
                i++
            }
            while (i < (size * 2) - 1) {
                roles.push({ name: i, lineupNumber: 2, type: ROLE_ATTACKER, pos: 0 })
                i++
            }
            roles.push({ ...GK, lineupNumber: 1, pos: 0 })
            roles.push({ ...GK, lineupNumber: 2, pos: 0 })
        }
        return new Lineup({
            channelId,
            size,
            roles,
            bench: [],
            name,
            autoSearch,
            allowRanked,
            team,
            type,
            visibility
        })
    }

    async updateLastNotificationTime(channelId: string, time: Date): Promise<UpdateWriteOpResult> {
        return Lineup.updateOne({ channelId }, { 'lastNotificationTime': time })
    }

    async deleteBansByGuildId(guildId: string): Promise<DeleteResult> {
        return Bans.deleteMany({ guildId })
    }

    async deleteBanByUserIdAndGuildId(userId: string, guildId: string): Promise<DeleteResult> {
        return Bans.deleteOne({ userId, guildId })
    }

    async findBanByUserIdAndGuildId(userId: string, guildId: string): Promise<IBan | null> {
        return Bans.findOne({ userId, guildId })
    }

    async findBansByGuildId(guildId: string): Promise<IBan[]> {
        return Bans.find({ guildId })
    }

    getBenchUserToTransfer(lineup: ILineup, roleLeft?: IRole): IUser | null {
        if (lineup.bench.length === 0 || !roleLeft) {
            return null
        }

        const benchRole = lineup.bench.find(role => role.roles.some(r => (r.name === roleLeft.name || r.name === ROLE_NAME_ANY) && r.lineupNumber === roleLeft.lineupNumber))
        return benchRole ? benchRole.user : null
    }

    private removeSpecialCharacters(name: string): string {
        return name.replace(/(:[^:]*:)|(<.*>)|\*/ig, '');
    }
}

export const teamService = new TeamService()

export interface RankedStats {
    role: IRole,
    rating: number,
    wins: number,
    draws: number,
    losses: number
}