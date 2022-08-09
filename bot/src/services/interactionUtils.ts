import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, Client, CommandInteraction, EmbedBuilder, Interaction, InteractionReplyOptions, InteractionUpdateOptions, Message, MessageOptions, SelectMenuBuilder, SelectMenuInteraction, User, UserManager } from "discord.js";
import { BOT_ADMIN_ROLE, DEFAULT_RATING } from "../constants";
import { IChallenge, ILineup, ILineupQueue, IRole, IRoleBench, IStats, ITeam, IUser, Stats } from "../mongoSchema";
import { handle } from "../utils";
import { authorizationService } from "./authorizationService";
import { matchmakingService, MatchResult, RoleWithDiscordUser } from "./matchmakingService";
import { statsService } from "./statsService";
import { ROLE_ATTACKER, ROLE_DEFENDER, ROLE_GOAL_KEEPER, ROLE_MIDFIELDER, TeamLogoDisplay, teamService, TeamTypeHelper, TEAM_REGION_EU } from "./teamService";

class InteractionUtils {
    createReplyAlreadyQueued(lineupSize: number): InteractionReplyOptions {
        return {
            content: `⛔ You are already queued for ${lineupSize}v${lineupSize}. Please use the /stop_search command before using this command`,
            ephemeral: true
        }
    }

    createReplyNotQueued(): InteractionReplyOptions {
        return {
            content: `⛔ Your team is not queued for matchmaking`,
            ephemeral: true
        }
    }

    createReplyTeamNotRegistered(): InteractionReplyOptions {
        return {
            content: '⛔ Please register your team with the /register_team command first',
            ephemeral: true
        }
    }

    createReplyMatchDoesntExist(): InteractionReplyOptions {
        return {
            content: '⛔ This match does not exist',
            ephemeral: true
        }
    }

    createReplyAlreadyChallenging(challenge: IChallenge): InteractionReplyOptions {
        return {
            content: `⛔ Your team is negotiating a challenge between the teams ${challenge.initiatingTeam.lineup.prettyPrintName()} and ${challenge.challengedTeam.lineup.prettyPrintName()}`,
            ephemeral: true
        }
    }

    createReplyLineupNotSetup(): InteractionReplyOptions {
        return {
            content: '⛔ This channel has no lineup configured yet. Use the /setup_lineup command to choose a lineup format',
            ephemeral: true
        }
    }

    createCancelChallengeReply(interaction: ButtonInteraction | CommandInteraction | SelectMenuInteraction, challenge: IChallenge): InteractionReplyOptions {
        let embed = new EmbedBuilder()
            .setColor('#566573')
            .setFooter({ text: `Author: ${interaction.user.username}` })
            .setTimestamp()

        if (challenge.challengedTeam.lineup.isMix()) {
            embed.setDescription(`💬 ${interaction.user} is challenging the mix ${challenge.challengedTeam.lineup.prettyPrintName()}.\nThe match will start automatically once the mix lineup is full.`)
        } else {
            embed.setDescription(`💬 ${interaction.user} has sent a challenge request to ${challenge.challengedTeam.lineup.prettyPrintName()}.\nYou can either wait for their answer, or cancel your request.`)
        }

        let cancelChallengeRow = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`cancel_challenge_${challenge._id}`)
                    .setLabel(`Cancel Challenge`)
                    .setStyle(ButtonStyle.Danger)
            )

        return { embeds: [embed], components: [cancelChallengeRow] }
    }

    createDecideChallengeReply(interaction: ButtonInteraction | CommandInteraction | SelectMenuInteraction, challenge: IChallenge): InteractionReplyOptions {
        if (challenge.challengedTeam.lineup.isMix()) {
            let reply = this.createReplyForMixLineup(challenge.challengedTeam.lineup, challenge.initiatingTeam.lineup)
            reply.embeds = reply.embeds?.concat(this.createInformationEmbed(interaction.user, `${challenge.initiatingTeam.lineup.prettyPrintName()} is challenging the mix`))
            return reply
        } else {
            let description = challenge.initiatingTeam.lineup.prettyPrintName(TeamLogoDisplay.LEFT, challenge.initiatingTeam.lineup.team.verified)
            const challengeEmbed = new EmbedBuilder()
                .setColor('#566573')
                .setTitle(`A team wants to play against you !`)
                .setTimestamp()
                .setFooter({ text: `Author: ${interaction.user.username}` })
            description += `\n${challenge.initiatingTeam.lineup.roles.filter(role => role.user != null).length} players signed`
            if (!teamService.hasGkSigned(challenge.initiatingTeam.lineup)) {
                description += ' **(no GK)**'
            }
            description += `\n\n*Contact ${challenge.initiatingUser.mention} for more information*`
            challengeEmbed.setDescription(description)
            let challengeActionRow = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`accept_challenge_${challenge._id}`)
                        .setLabel('Accept')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`refuse_challenge_${challenge._id}`)
                        .setLabel('Refuse')
                        .setStyle(ButtonStyle.Danger)
                )
            return { embeds: [challengeEmbed], components: [challengeActionRow] }
        }
    }

    async createReplyForLineup(lineup: ILineup, lineupQueue?: ILineupQueue): Promise<InteractionReplyOptions> {
        if (lineup.isMix() || lineup.isPicking) {
            const challenge = await matchmakingService.findChallengeByChannelId(lineup.channelId)
            let challengingLineup
            if (challenge) {
                challengingLineup = await teamService.retrieveLineup(challenge.initiatingTeam.lineup.channelId)
            }
            return this.createReplyForMixLineup(lineup, challengingLineup)
        }

        if (lineup.isCaptains()) {
            return this.createReplyForCaptainsLineup(lineup)
        }

        return this.createReplyForTeamLineup(lineup, lineupQueue)
    }

    createCaptainsPickComponent(roles: IRole[]): ActionRowBuilder<ButtonBuilder>[] {
        const captainActionsComponents = []
        let i = 0
        for (let role of roles) {
            if (!role.user) {
                continue
            }

            if (i % 5 === 0) {
                captainActionsComponents.push(new ActionRowBuilder<ButtonBuilder>())
            }

            let playerName = role.user.name.substring(0, 60)
            if (role.name.includes('GK')) {
                playerName += ' (GK)'
            }
            captainActionsComponents[captainActionsComponents.length - 1].addComponents(
                new ButtonBuilder()
                    .setCustomId(`pick_${role.user.id}_${i}`)
                    .setLabel(playerName)
                    .setStyle(ButtonStyle.Primary)
            )
            i++
        }

        return captainActionsComponents
    }

    async replyNotAllowed(interaction: ButtonInteraction | CommandInteraction | SelectMenuInteraction): Promise<void> {
        await interaction.reply({ content: `⛔ You are not allowed to execute this command. Make sure that you have either admin permissions on the discord, or a role named **${BOT_ADMIN_ROLE}**`, ephemeral: true })
    }

    async createStatsEmbeds(interaction: ButtonInteraction | CommandInteraction | SelectMenuInteraction, userId: string, region?: string): Promise<EmbedBuilder[]> {
        const user = interaction.client.users.resolve(userId)
        const foundStats = await statsService.findUsersStats([userId], region)
        let stats: IStats
        if (foundStats.length === 0) {
            stats = new Stats({
                userId,
                region: 'Europe',
                numberOfGames: 0,
                numberOfRankedGames: 0,
                numberOfRankedWins: 0,
                numberOfRankedDraws: 0,
                numberOfRankedLosses: 0,
                attackRating: DEFAULT_RATING,
                midfieldRating: DEFAULT_RATING,
                defenseRating: DEFAULT_RATING,
                goalKeeperRating: DEFAULT_RATING,
                mixCaptainsRating: DEFAULT_RATING
            })
        } else {
            stats = foundStats[0]
        }

        return [
            new EmbedBuilder()
                .setColor('#566573')
                .setTitle(`${region ? '⛺ Region' : '🌎 Global'} Stats for ${user?.username}`)
                .addFields([
                    { name: '📈 Ratings', value: `**Att:** ${stats.attackRating || DEFAULT_RATING} \n **Mid:** ${stats.midfieldRating || DEFAULT_RATING} \n **Def:** ${stats.defenseRating || DEFAULT_RATING} \n **GK:** ${stats.goalKeeperRating || DEFAULT_RATING} \n **Captains Mix:** ${stats.mixCaptainsRating || DEFAULT_RATING}`, inline: true },
                    { name: '⚽ Ranked Matches', value: `**Wins:** ${stats.numberOfRankedWins} \n **Draws:** ${stats.numberOfRankedDraws} \n **Losses:** ${stats.numberOfRankedLosses}`, inline: true },
                    { name: '\u200B', value: '\u200B' },
                    { name: 'Ranked Games Played *(deprecated)*', value: stats.numberOfRankedGames.toString() },
                    { name: 'Total Games Played *(deprecated)*', value: stats.numberOfGames.toString() }
                ])
        ]
    }

    async createLeaderboardReply(interaction: Interaction, team: ITeam, searchOptions: StatsSearchOptions): Promise<InteractionReplyOptions | InteractionUpdateOptions> {
        let numberOfItems
        if (searchOptions.statsType === StatsType.TEAMS) {
            numberOfItems = await statsService.countNumberOfTeams(team.region)
        } else {
            numberOfItems = await statsService.countNumberOfPlayers(team.region)
        }
        const numberOfPages = Math.ceil(numberOfItems / searchOptions.pageSize)

        if (searchOptions.page === -1) {
            searchOptions.page = numberOfPages - 1
        }

        const leaderboardEmbed: EmbedBuilder = await this.createLeaderboardEmbed(interaction, team, numberOfPages, searchOptions)
        const scopeActionRow = new ActionRowBuilder<SelectMenuBuilder>().addComponents(
            new SelectMenuBuilder()
                .setCustomId(`leaderboard_scope_select_${searchOptions.statsType}_${searchOptions.gameType}`)
                .setPlaceholder('Stats Scope')
                .addOptions([
                    {
                        emoji: '🌎',
                        label: 'International',
                        value: StatsScope.INTERNATIONAL.toString(),
                        default: searchOptions.statsScope === StatsScope.INTERNATIONAL
                    },
                    {
                        emoji: '⛺',
                        label: 'Regional',
                        value: StatsScope.REGIONAL.toString(),
                        default: searchOptions.statsScope === StatsScope.REGIONAL
                    }
                ])
        )
        const statsTypeActionRow = new ActionRowBuilder<SelectMenuBuilder>().addComponents(
            new SelectMenuBuilder()
                .setCustomId(`leaderboard_type_select_${searchOptions.statsScope}_${searchOptions.gameType}`)
                .setPlaceholder('Stats Type')
                .addOptions([
                    {
                        emoji: '👕',
                        label: 'Teams',
                        value: StatsType.TEAMS.toString(),
                        default: searchOptions.statsType === StatsType.TEAMS
                    },
                    {
                        emoji: '🏅',
                        label: 'Players',
                        value: StatsType.PLAYERS.toString(),
                        default: searchOptions.statsType === StatsType.PLAYERS
                    }
                ])
        )
        const gameTypeActionRow = new ActionRowBuilder<SelectMenuBuilder>().addComponents(
            new SelectMenuBuilder()
                .setCustomId(`leaderboard_game_type_select_${searchOptions.statsType}_${searchOptions.statsScope}`)
                .setPlaceholder('Game Type')
                .addOptions([
                    {
                        emoji: '👕',
                        label: 'Teams And Mixes',
                        value: GameType.TEAM_AND_MIX.toString(),
                        default: searchOptions.gameType === GameType.TEAM_AND_MIX
                    },
                    {
                        emoji: '🤼',
                        label: 'Captains Mixes',
                        value: GameType.CAPTAINS_MIX.toString(),
                        default: searchOptions.gameType === GameType.CAPTAINS_MIX
                    }
                ])
        )

        const paginationActionRow = this.createLeaderboardPaginationActionRow(numberOfPages, searchOptions)

        const components: ActionRowBuilder<ButtonBuilder | SelectMenuBuilder>[] = [scopeActionRow, statsTypeActionRow]
        if (searchOptions.statsType === StatsType.PLAYERS) {
            components.push(gameTypeActionRow)
        }
        components.push(paginationActionRow)

        return { embeds: [leaderboardEmbed], components, ephemeral: true }
    }

    async createLeaderboardEmbed(interaction: Interaction, team: ITeam, numberOfPages: number, searchOptions: StatsSearchOptions): Promise<EmbedBuilder> {
        if (searchOptions.statsType === StatsType.TEAMS) {
            return this.createTeamLeaderboardEmbed(team, numberOfPages, searchOptions)
        }
        return this.createPlayersLeaderboardEmbed(interaction.client.users, team, numberOfPages, searchOptions)
    }

    async createTeamLeaderboardEmbed(team: ITeam, numberOfPages: number, searchOptions: StatsSearchOptions): Promise<EmbedBuilder> {
        const teamsStats = await statsService.findTeamsStats(searchOptions.page, searchOptions.pageSize, searchOptions.statsScope === StatsScope.REGIONAL ? team.region : undefined) as ITeam[]

        let teamStatsEmbed = new EmbedBuilder()
            .setColor('#566573')
            .setTitle('🏆 Leaderboard 🏆')
        if (teamsStats.length === 0) {
            teamStatsEmbed.addFields([{ name: 'Ooooof', value: 'This looks pretty empty here. Time to get some games lads !' }])
        } else {
            let fieldValue = ''
            let pos = (searchOptions.pageSize * searchOptions.page) + 1
            for (let teamStats of teamsStats) {
                let emoji = ''
                if (pos === 1) {
                    emoji = '🥇'
                } else if (pos === 2) {
                    emoji = '🥈'
                } else if (pos === 3) {
                    emoji = '🥉'
                }
                let isTop3 = pos <= 3
                fieldValue += `${isTop3 ? '**' : ''}${pos}. ${emoji} ${teamStats.logo ? `${teamStats.logo} ` : ''}${teamStats.name} *(${teamStats.rating || DEFAULT_RATING})* ${emoji}${isTop3 ? '**' : ''}\n`
                pos++
            }
            teamStatsEmbed.addFields([{ name: `Page ${searchOptions.page + 1}/${numberOfPages}`, value: fieldValue }])
        }

        return teamStatsEmbed
    }

    async createPlayersLeaderboardEmbed(usersManager: UserManager, team: ITeam, numberOfPages: number, searchOptions: StatsSearchOptions): Promise<EmbedBuilder> {
        let playersStats = await statsService.findPlayersStats(searchOptions.page, searchOptions.pageSize, searchOptions.gameType, searchOptions.statsScope === StatsScope.REGIONAL ? team.region : undefined)
        let playersStatsEmbed = new EmbedBuilder()
            .setColor('#566573')
            .setTitle('🏆 Leaderboard 🏆')
        if (playersStats.length === 0) {
            playersStatsEmbed.addFields([{ name: 'Ooooof', value: 'This looks pretty empty here. Time to get some games lads !' }])
        } else {
            let fieldValue = ''
            let pos = (searchOptions.pageSize * searchOptions.page) + 1
            for (let playerStats of playersStats) {
                let [user] = await handle(usersManager.fetch(playerStats._id.toString()))
                const username = user ? user.username : '*deleted user*'
                let emoji = ''
                if (pos === 1) {
                    emoji = '🥇'
                } else if (pos === 2) {
                    emoji = '🥈'
                } else if (pos === 3) {
                    emoji = '🥉'
                }
                let isTop3 = pos <= 3
                fieldValue += `${isTop3 ? '**' : ''}${pos}. ${emoji} ${username} - ${(playerStats as any).rating || DEFAULT_RATING}  *(${playerStats.numberOfRankedWins} - ${playerStats.numberOfRankedDraws} - ${playerStats.numberOfRankedLosses})* ${emoji}${isTop3 ? '**' : ''}\n`
                pos++
            }

            playersStatsEmbed.addFields([{ name: `Page ${searchOptions.page + 1}/${numberOfPages}`, value: fieldValue }])
        }

        return playersStatsEmbed
    }


    createLeaderboardPaginationActionRow(numberOfPages: number, searchOptions: StatsSearchOptions): ActionRowBuilder<ButtonBuilder> {
        const paginationActionsRow = new ActionRowBuilder<ButtonBuilder>()
        paginationActionsRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`leaderboard_page_first_${searchOptions.statsScope}_${searchOptions.statsType}_${searchOptions.gameType}`)
                .setLabel('<<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(searchOptions.page === 0),
            new ButtonBuilder()
                .setCustomId(`leaderboard_page_${searchOptions.page - 1}_${searchOptions.statsScope}_${searchOptions.statsType}_${searchOptions.gameType}`)
                .setLabel('<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(searchOptions.page === 0),
            new ButtonBuilder()
                .setCustomId(`leaderboard_page_${searchOptions.page + 1}_${searchOptions.statsScope}_${searchOptions.statsType}_${searchOptions.gameType}`)
                .setLabel('>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(searchOptions.page >= numberOfPages - 1),
            new ButtonBuilder()
                .setCustomId(`leaderboard_page_last_${searchOptions.statsScope}_${searchOptions.statsType}_${searchOptions.gameType}`)
                .setLabel('>>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(searchOptions.page >= numberOfPages - 1)
        )

        return paginationActionsRow
    }

    createLineupEmbed(rolesWithDiscordUsers: RoleWithDiscordUser[], lineup: ILineup): EmbedBuilder {
        let embedTitle = lineup.prettyPrintName()
        let lineupEmbed = new EmbedBuilder()
            .setColor('#6aa84f')
            .setTitle(embedTitle)

        let description = ''
        rolesWithDiscordUsers.map(roleWithDiscordUser => {
            const role = roleWithDiscordUser.role
            const discordUser = roleWithDiscordUser.discordUser
            description += `**${role.name}:** ${role.user?.emoji || ''} ${role.user?.name || ''}`
            if (discordUser) {
                description += ` *(${discordUser})*`
            }
            description += '\n'
        })
        lineupEmbed.setDescription(description)

        return lineupEmbed
    }

    createInformationEmbed(author: User, description: string): EmbedBuilder {
        return new EmbedBuilder()
            .setColor('#566573')
            .setTimestamp()
            .setDescription(description)
            .setFooter({ text: `Author: ${author.username}` })
    }

    async createBanListEmbed(client: Client, guildId: string): Promise<EmbedBuilder> {
        const banListEmbed = new EmbedBuilder()
            .setColor('#566573')
            .setTitle(`Matchmaking Bans`)
        const bans = await teamService.findBansByGuildId(guildId)

        if (bans.length === 0) {
            banListEmbed.setDescription("✅ No user is banned")
        } else {
            for (let ban of bans) {
                const [user] = await handle(client.users.fetch(ban.userId))
                if (!user) {
                    continue
                }
                let bansEmbedFieldValue = '*Permanent*'
                if (ban.expireAt) {
                    bansEmbedFieldValue = ban.expireAt.toUTCString()
                }
                if (ban.reason) {
                    bansEmbedFieldValue += `***(Reason: ${ban.reason})***`
                }
                banListEmbed.addFields([{ name: user.username, value: bansEmbedFieldValue }])
            }
        }

        return banListEmbed
    }

    createLineupComponents(lineup: ILineup, lineupQueue?: ILineupQueue, challenge?: IChallenge, selectedLineupNumber: number = 1): ActionRowBuilder<ButtonBuilder>[] {
        const actionRows = this.createRolesActionRows(lineup, selectedLineupNumber)
        const lineupActionsRow = new ActionRowBuilder<ButtonBuilder>()
        const numberOfSignedPlayers = lineup.roles.filter(role => role.lineupNumber === selectedLineupNumber).filter(role => role.user != null).length
        lineupActionsRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`bench_${selectedLineupNumber}`)
                .setLabel('Sign Bench')
                .setDisabled(numberOfSignedPlayers === 0)
                .setStyle(ButtonStyle.Primary)
        )
        if (!lineup.isMix()) {
            lineupActionsRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`leaveLineup`)
                    .setLabel(`Leave`)
                    .setStyle(ButtonStyle.Danger)
            )

            if (challenge) {
                if (challenge.initiatingTeam.lineup.channelId === lineup.channelId) {
                    lineupActionsRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`cancel_challenge_${challenge._id}`)
                            .setLabel(`Cancel Challenge`)
                            .setStyle(ButtonStyle.Danger)
                    )
                } else {
                    lineupActionsRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`accept_challenge_${challenge._id}`)
                            .setLabel(`Accept`)
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`refuse_challenge_${challenge._id}`)
                            .setLabel(`Refuse`)
                            .setStyle(ButtonStyle.Danger)
                    )
                }
            } else {
                if (lineupQueue) {
                    lineupActionsRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`stopSearch`)
                            .setLabel(`Stop search`)
                            .setStyle(ButtonStyle.Danger)
                    )
                } else {
                    lineupActionsRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId('startSearch')
                            .setLabel('Search')
                            .setDisabled(!matchmakingService.isLineupAllowedToJoinQueue(lineup))
                            .setStyle(ButtonStyle.Success)
                    )
                }
            }

            if (!challenge) {
                lineupActionsRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`listChallenges`)
                        .setLabel(`Challenges`)
                        .setStyle(ButtonStyle.Primary)
                )
            }
        }

        lineupActionsRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`other_${selectedLineupNumber}`)
                .setLabel('Other')
                .setStyle(ButtonStyle.Secondary)
        )

        actionRows.push(lineupActionsRow)

        return actionRows
    }

    createRolesActionRows(lineup: ILineup, selectedLineupNumber = 1, isBench: boolean = false): ActionRowBuilder<ButtonBuilder>[] {
        const roles = lineup.roles.filter(role => role.lineupNumber === selectedLineupNumber)
        const attackerRoles = roles.filter(role => role.type === ROLE_ATTACKER)
        const midfielderRoles = roles.filter(role => role.type === ROLE_MIDFIELDER)
        const defenderRoles = roles.filter(role => role.type === ROLE_DEFENDER)
        const gkRole = roles.filter(role => role.type === ROLE_GOAL_KEEPER)

        const maxRolePos = Math.max(
            Math.max(...attackerRoles.map(role => role.pos)),
            Math.max(...midfielderRoles.map(role => role.pos)),
            Math.max(...defenderRoles.map(role => role.pos)),
            Math.max(...gkRole.map(role => role.pos))
        )

        let rolesActionRows: ActionRowBuilder<ButtonBuilder>[] = []
        if (attackerRoles.length > 0) {
            rolesActionRows.push(this.createRoleActionRow(maxRolePos, attackerRoles, isBench))
        }

        if (midfielderRoles.length > 0) {
            rolesActionRows.push(this.createRoleActionRow(maxRolePos, midfielderRoles, isBench))
        }

        if (defenderRoles.length > 0) {
            rolesActionRows.push(this.createRoleActionRow(maxRolePos, defenderRoles, isBench))
        }

        if (gkRole.length > 0) {
            rolesActionRows.push(this.createRoleActionRow(maxRolePos, gkRole, isBench))
        }

        return rolesActionRows
    }

    createMatchResultVoteMessage(matchId: string, region: string, user: User): MessageOptions {
        const matchVoteEmbed = new EmbedBuilder()
            .setColor('#6aa84f')
            .setTitle(":bangbang::bangbang: Submit for you team result ! :bangbang::bangbang:")
            .setFields([
                { name: 'Match ID', value: matchId, inline: true },
                { name: 'Submitter', value: `${user}`, inline: true }]
            )
            .setDescription(
                `Ranks will be updated **ONLY** if **BOTH TEAMS** votes are consistent.
                **Be fair and honest and submit real result.** 
                ${region === TEAM_REGION_EU ? 'If needed, use the [Ticket Tool](https://discord.com/channels/913821068811178045/914202504747688006) on EU server to report any abuse.' : ''}
            `)
            .setTimestamp()
        const matchVoteActionRow = new ActionRowBuilder<ButtonBuilder>()
        matchVoteActionRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`match_result_vote_${MatchResult.WIN}_${matchId}_${user.id}`)
                .setLabel("WIN !")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`match_result_vote_${MatchResult.DRAW}_${matchId}_${user.id}`)
                .setLabel("DRAW")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`match_result_vote_${MatchResult.LOSS}_${matchId}_${user.id}`)
                .setLabel("LOSS")
                .setStyle(ButtonStyle.Danger),
        )

        return { embeds: [matchVoteEmbed], components: [matchVoteActionRow] }
    }

    createMatchResultVoteUserMessage(message: Message): MessageOptions {
        const matchVoteEmbed = new EmbedBuilder()
            .setColor('#6aa84f')
            .setTitle(":bangbang::bangbang: Submit your team result ! :bangbang::bangbang:")
            .setDescription(`Don't forget to submit your team result by clicking [here](${message.url}) after the match ended !`)
            .setTimestamp()

        return { embeds: [matchVoteEmbed] }
    }

    createTeamManagementReply(interaction: Interaction, team: ITeam): InteractionReplyOptions {
        const captainsList = team.captains.map(captain => `${captain.name} (${captain.mention})`).join('\n')
        const playersList = team.players.map(player => `${player.name} (${player.mention})`).join('\n')
        const teamDescriptionEmbed = new EmbedBuilder()
            .setTitle('Team Management')
            .setFooter({ text: "If you add/remove any captains/players, your will need to verify your team again in order to play ranked matches" })
            .setColor('#566573')
            .addFields([
                { name: 'Verified', value: `${team.verified ? '**✅ Yes**' : '❌ No'}` },
                { name: 'Team ID', value: team.guildId, inline: true },
                { name: 'Region', value: team.region, inline: true },
                { name: 'Type', value: `${TeamTypeHelper.toString(team.type)}`, inline: true },
                { name: 'Name', value: team.name, inline: true },
                { name: 'Logo', value: `${team.logo ? `${team.logo}` : '*None*'}`, inline: true },
                { name: 'Code', value: `${team.code ? `**${team.code}**` : '*None*'}`, inline: true },
                { name: 'Rating', value: `${team.rating}`},
                { name: 'Captains', value: `${captainsList.length > 0 ? captainsList : '*None*'}`, inline: true },
                { name: 'Players', value: `${playersList.length > 0 ? playersList : '*None*'}`, inline: true },
            ])

        const teamManagementActionRow: ActionRowBuilder<ButtonBuilder> = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Team Type')
                    .setCustomId(`team_manage_type_${team.guildId}`)
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setLabel('Team Logo')
                    .setCustomId(`team_manage_logo_${team.guildId}`)
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setLabel('Team Name')
                    .setCustomId(`team_manage_name_${team.guildId}`)
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setLabel('Team Code')
                    .setCustomId(`team_manage_code_${team.guildId}`)
                    .setStyle(ButtonStyle.Primary)
            )

        const playersManagementActionRow: ActionRowBuilder<ButtonBuilder> = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Manage captains')
                    .setCustomId(`team_manage_captains_${team.guildId}`)
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setLabel('Manage players')
                    .setCustomId(`team_manage_players_${team.guildId}`)
                    .setStyle(ButtonStyle.Primary)
            )

        let components = [teamManagementActionRow, playersManagementActionRow
        ]
        if (authorizationService.isOfficialDiscord(interaction.guildId!)) {
            const adminTeamManagementActionRow: ActionRowBuilder<ButtonBuilder> = new ActionRowBuilder<ButtonBuilder>()
            if (!team.verified) {
                adminTeamManagementActionRow.addComponents(
                    new ButtonBuilder()
                        .setLabel('Verify')
                        .setCustomId(`team_manage_state_verify_${team.guildId}`)
                        .setStyle(ButtonStyle.Success)
                )
            } else {
                adminTeamManagementActionRow.addComponents(
                    new ButtonBuilder()
                        .setLabel('Unverify')
                        .setCustomId(`team_manage_state_unverify_${team.guildId}`)
                        .setStyle(ButtonStyle.Danger)
                )
            }

            adminTeamManagementActionRow.addComponents(
                new ButtonBuilder()
                    .setLabel('Ban')
                    .setCustomId(`team_ban_${team.guildId}`)
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(true)
            )
            components.push(adminTeamManagementActionRow)
        }

        return { embeds: [teamDescriptionEmbed], components, ephemeral: true }
    }

    private createRoleActionRow(maxRolePos: number, roles: IRole[], isBench: boolean = false): ActionRowBuilder<ButtonBuilder> {
        let actionRow = new ActionRowBuilder<ButtonBuilder>()
        for (let pos = 0; pos <= maxRolePos; pos++) {
            const role = roles.find(role => role.pos === pos)
            if (role) {
                actionRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`${isBench ? 'benchRole' : 'role'}_${role.name}_${role.lineupNumber}`)
                        .setLabel(role.name)
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(isBench ? !role.user : role.user != null)
                )
            } else {
                actionRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`${pos}_${Math.random()}`)
                        .setLabel('\u200b')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                )
            }
        }
        return actionRow
    }

    private async createReplyForTeamLineup(lineup: ILineup, lineupQueue?: ILineupQueue): Promise<InteractionReplyOptions> {
        const challenge = await matchmakingService.findChallengeByChannelId(lineup.channelId) || undefined

        const lineupEmbed = new EmbedBuilder()
            .setTitle(lineup.prettyPrintName(TeamLogoDisplay.LEFT, lineup.team.verified))
            .setColor('#566573')

        this.fillLineupEmbedWithRoles(lineupEmbed, lineup.roles, lineup.bench, lineup.team.verified)
        const components = this.createLineupComponents(lineup, lineupQueue, challenge)

        return { embeds: [lineupEmbed], components }
    }

    private createReplyForMixLineup(lineup: ILineup, challengingLineup?: ILineup | null): InteractionReplyOptions {
        let firstLineupEmbed = new EmbedBuilder()
            .setColor('#ed4245')
            .setTitle(`Red Team${lineup.allowRanked ? ` *(${lineup.computePlayersAverageRating(1)})*` : ''}`)
        this.fillLineupEmbedWithRoles(firstLineupEmbed, lineup.roles.filter(role => role.lineupNumber === 1), lineup.bench.filter(benchRole => benchRole.roles[0].lineupNumber === 1), lineup.team.verified)

        let secondLineupEmbed
        if (challengingLineup) {
            secondLineupEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`:vs:`)
            let fieldValue = challengingLineup.roles.filter(role => role.user != null).length + ' players signed'
            if (!teamService.hasGkSigned(challengingLineup)) {
                fieldValue += ' **(no GK)**'
            }
            secondLineupEmbed.addFields([{ name: challengingLineup.prettyPrintName(TeamLogoDisplay.LEFT, lineup.team.verified), value: fieldValue }])
        } else {
            secondLineupEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`Blue Team${lineup.allowRanked ? ` *(${lineup.computePlayersAverageRating(2)})*` : ''}`)
                .setFooter({ text: 'If a Team faces the mix, it will replace the Blue Team' })
            this.fillLineupEmbedWithRoles(secondLineupEmbed, lineup.roles.filter(role => role.lineupNumber === 2), lineup.bench.filter(benchRole => benchRole.roles[0].lineupNumber === 2), lineup.team.verified)
        }

        const lineupActionsComponent = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`mix_lineup_1`)
                .setLabel(`Red Team`)
                .setStyle(ButtonStyle.Danger)
        )

        if (!challengingLineup) {
            lineupActionsComponent.addComponents(
                new ButtonBuilder()
                    .setCustomId(`mix_lineup_2`)
                    .setLabel(`Blue Team`)
                    .setStyle(ButtonStyle.Primary)
            )
        }

        lineupActionsComponent.addComponents(
            new ButtonBuilder()
                .setCustomId(`leaveLineup`)
                .setLabel(`Leave`)
                .setStyle(ButtonStyle.Secondary)
        )

        return { embeds: [firstLineupEmbed, secondLineupEmbed], components: [lineupActionsComponent] }
    }

    private createReplyForCaptainsLineup(lineup: ILineup): InteractionReplyOptions {
        let lineupEmbed = new EmbedBuilder()
            .setColor('#ed4245')
            .setTitle(`Player Queue`)
        this.fillLineupEmbedWithRoles(lineupEmbed, lineup.roles, lineup.bench, lineup.allowRanked)

        const numberOfOutfieldUsers = lineup.roles.filter(role => !role.name.includes('GK') && role.user).length
        const numberOfGkUsers = lineup.roles.filter(role => role.name.includes('GK') && role.user).length
        const lineupActionsComponent = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`leaveQueue`)
                .setLabel(`Leave`)
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`join_outfield`)
                .setLabel(`Join`)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(numberOfOutfieldUsers === lineup.size * 2 - 2),
            new ButtonBuilder()
                .setCustomId(`join_gk`)
                .setLabel(`Join as GK`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(numberOfGkUsers === 2))

        return { embeds: [lineupEmbed], components: [lineupActionsComponent] }
    }

    private fillLineupEmbedWithRoles(lineupEmbed: EmbedBuilder, roles: IRole[], bench: IRoleBench[], ranked: boolean): void {
        let description = roles.map(role => `**${role.name}:** ${this.formatPlayerName(ranked, role.user)}`).join('\n')

        if (bench.length > 0) {
            description += '\n\n*Bench: '
            description += bench.map(benchRole => `${this.formatPlayerName(ranked, benchRole.user)} (${benchRole.roles.map(role => role.name).join(', ')})`).join(', ')
            description += '*\n'
        }

        lineupEmbed.setDescription(description)
    }

    private formatPlayerName(ranked: boolean, user?: IUser) {
        let playerName = ''
        if (user) {
            if (user.emoji) {
                playerName += user.emoji
            }
            playerName += `${user.name}`
            if (ranked) {
                playerName += ` *(${user.rating})*`
            }
        } else {
            playerName = '\u200b'
        }

        return playerName
    }
}

export interface StatsSearchOptions {
    page: number,
    pageSize: number,
    statsScope: StatsScope,
    statsType: StatsType,
    gameType: GameType
}

export enum GameType {
    TEAM_AND_MIX,
    CAPTAINS_MIX
}

export enum StatsScope {
    INTERNATIONAL,
    REGIONAL
}

export enum StatsType {
    TEAMS,
    PLAYERS
}

export const interactionUtils = new InteractionUtils()