const { SlashCommandBuilder } = require('@discordjs/builders');
const interactionUtils = require("../../services/interactionUtils");
const matchmakingService = require("../../services/matchmakingService");
const teamService = require("../../services/teamService");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear_lineup')
        .setDescription('Clears every roles in this lineup'),
    async execute(interaction) {
        let challenge = await matchmakingService.findChallengeByChannelId(interaction.channelId)
        if (challenge) {
            await interaction.reply(interactionUtils.createReplyAlreadyChallenging(challenge))
            return
        }

        let team = await teamService.findTeamByGuildId(interaction.guildId)
        if (!team) {
            await interaction.reply(interactionUtils.createReplyTeamNotRegistered())
            return
        }

        let lineup = await teamService.retrieveLineup(interaction.channelId)
        if (!lineup) {
            await interaction.reply(interactionUtils.createReplyLineupNotSetup())
            return
        }

        let lineupQueue = await matchmakingService.findLineupQueueByChannelId(interaction.channelId)
        if (!lineup.isMixOrCaptains() && lineupQueue) {
            await interaction.reply(interactionUtils.createReplyAlreadyQueued(lineupQueue.lineup.size))
            return
        }

        if (lineup.isPicking) {
            await interaction.reply({ content: '⛔ Captains are currently picking the teams', ephemeral: true })
            return
        }

        lineup = await teamService.clearLineup(interaction.channelId, [1, 2])
        await matchmakingService.clearLineupQueue(interaction.channelId, [1, 2])
        let reply = await interactionUtils.createReplyForLineup(interaction, lineup, lineupQueue)
        reply.content = `✅ Lineup has been cleared !`
        await interaction.reply(reply);
    },
};