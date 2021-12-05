const { SlashCommandBuilder } = require('@discordjs/builders');
const interactionUtils = require("../services/interactionUtils");
const teamService = require("../services/teamService");
const matchmakingService = require("../services/matchmakingService");
const { MessageEmbed } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Displays the status of your lineup'),
    async execute(interaction) {
        let team = await teamService.findTeamByGuildId(interaction.guildId)
        if (!team) {
            interactionUtils.replyTeamNotRegistered(interaction)
            return
        }

        let lineup = await teamService.retrieveLineup(interaction.channelId)
        if (!lineup) {
            interactionUtils.replyLineupNotSetup(interaction)
            return
        }

        const lineupStatusEmbed = new MessageEmbed()
            .setColor('#0099ff')
            .setTimestamp()
            .setFooter(`Author: ${interaction.user.username}`)
            .addField('Lineup size', `${lineup.size}v${lineup.size}`, true)
            .addField('Auto-search', `${lineup.autoSearch ? '**enabled**' : '*disabled*'}`, true)

        let challenge = await matchmakingService.findChallengeByChannelId(interaction.channelId)
        if (challenge) {
            lineupStatusEmbed.setTitle(`💬 Your lineup is negotiating a challenge ...`)
        } else {
            let lineupQueue = await matchmakingService.findLineupQueueByChannelId(lineup.channelId)
            if (lineupQueue) {
                lineupStatusEmbed.setTitle("🔎 Your lineup is searching for a Team ...")
            } else {
                lineupStatusEmbed.setTitle("Your lineup is not searching for a Team")
            }
        }

        await interaction.reply({ embeds: [lineupStatusEmbed], components: interactionUtils.createLineupComponents(lineup) })
    },
};