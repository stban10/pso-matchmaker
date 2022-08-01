import { SlashCommandBuilder } from "@discordjs/builders";
import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { ICommandHandler } from "../../handlers/commandHandler";

export default {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Something you don\'t understand ?'),
    async execute(interaction: ChatInputCommandInteraction) {
        const titleEmbed = new EmbedBuilder()
            .setColor('#566573')
            .setTitle(`What is PSO Matchmaker ?`)
            .setTimestamp()
            .setDescription(`**PSO (Pro Soccer Online) Matchmaker** is a discord bot that is here to help you create your own **team** with your friends and challenge other **teams**. 
            Each **Team** can be a *competitive* team (with members that wish to compete in turnaments for example), or a *mix* team (with any PSO player mixed all together, like the :flag_eu: PSO EU team)`)

        const setupEmbed = new EmbedBuilder()
            .setColor('#566573')
            .setTitle(`How to configure the bot ?`)
            .setTimestamp()
            .addFields([
                { name: '1) Invite the bot on your discord', value: 'Click on the following link to invite the bot on your discord server: https://discord.com/api/oauth2/authorize?client_id=914818953707151420&permissions=2147904576&scope=applications.commands%20bot' },
                { name: '2) Create your team', value: 'Use the **/register_team** command anywhere on your discord server to create your team. Make sure you select the correct region.' },
                {
                    name: '3) Create lineups',
                    value: `
                            On any channel in you discord server, use one of the following command to configure a lineup and get ready to play and face other teams.
                
                            **/setup_lineup**: If you want to challenge other teams and mix, this is the command you need. You just have to choose a size (from 1 up to 11 players !) and you're ready to go !
                
                            **/setup_mix**: If you want to play with friends, but don't want to make it official or play in any competition, you can use this command to setup a mix lineup. With mix, you can play with each other, or even against a team if they decide to challenge you !
                
                            **/setup_mix_captains**: This command is very similar to the /setup_mix command, but instead of choosing a pre-defined position, the teams are picked by a captain on each team
                            `
                },
                {
                    name: '4) Command Permissions',
                    value: `
                            The following commands require higher permissions to be used: 
                            - **/register_team**
                            - **/team_name**
                            - **/team_region**
                            - **/delete_team**
                            - **/setup_lineup**
                            - **/setup_mix**
                            - **/setup_mix_captains**
                            - **/delete_lineup**
                            - **/ban**
                            - **/unban**
                            - **/ban_list**
                
                            By Default, the Discord server administrator has access to all of these commands. If you wish to give someone else's permission for these commands, create a role named **'PSO MM ADMIN'** and give it to them.
                            `
                }
            ])

        const matchmakingEmbed = new EmbedBuilder()
            .setColor('#566573')
            .setTitle(`How to use the matchmaking ?`)
            .setTimestamp()
            .addFields(
                [
                    { name: 'Want to see the teams that are looking for a match ?', value: 'Use the **/challenges** command.' },
                    { name: 'Want other teams to be aware that you are looking for a match ?', value: 'Use the **/search** command.' },
                    { name: 'Want to hide your team from other teams ?', value: 'Use the **/stop_search** command.' },
                    { name: 'Want to sign in your lineup or see its status ?', value: 'Use the **/status** command.' }
                ]
            )

        const otherEmbed = new EmbedBuilder()
            .setColor('#566573')
            .setTitle(`Other`)
            .setTimestamp()
            .addFields([{ name: 'Want to report a bug or suggest a feature ?', value: 'Send a direct message to grass#6639' }])

        await interaction.reply({
            embeds: [titleEmbed, setupEmbed, matchmakingEmbed, otherEmbed],
            ephemeral: true
        })
    },
} as ICommandHandler