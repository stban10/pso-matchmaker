import { GuildMember, MessageOptions, SelectMenuInteraction } from "discord.js";
import { MAX_BENCH_SIZE } from "../../constants";
import { ISelectMenuHandler } from "../../handlers/selectMenuHandler";
import { ILineup } from "../../mongoSchema";
import { interactionUtils } from "../../services/interactionUtils";
import { ROLE_NAME_ANY, teamService } from "../../services/teamService";

export default {
    customId: 'select_bench',
    async execute(interaction: SelectMenuInteraction) {
        let lineup = await teamService.retrieveLineup(interaction.channelId)
        if (lineup === null) {
            await interaction.reply(interactionUtils.createReplyLineupNotSetup())
            return
        }

        const signedUser = lineup.roles.find(role => role.user?.id === interaction.user.id)
        if (signedUser) {
            await interaction.reply({ content: '⛔ You are already in the lineup', ephemeral: true })
            return
        }

        if (lineup.bench.length >= MAX_BENCH_SIZE) {
            await interaction.reply({ content: '⛔ There are too many benched players, please try again later', ephemeral: true })
            return
        }

        await interaction.update({ components: [] })

        const selectedLineupNumber = parseInt(interaction.customId.split('_')[2])
        const selectedRolesNames = interaction.values.some(value => value === ROLE_NAME_ANY) ? [ROLE_NAME_ANY] : interaction.values
        lineup = (await teamService.joinBench(interaction.user, lineup, selectedRolesNames, selectedLineupNumber, interaction.member as GuildMember)) as ILineup

        let reply = await interactionUtils.createReplyForLineup(interaction, lineup) as MessageOptions
        const informationEmbed = interactionUtils.createInformationEmbed(interaction.user, `:inbox_tray: ${interaction.user} benched as **${selectedRolesNames.join(', ')}**`)
        reply.embeds = (reply.embeds || []).concat(informationEmbed)
        await interaction.channel?.send(reply)
    }
} as ISelectMenuHandler