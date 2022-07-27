import { Client } from "discord.js";
import mongoose from "mongoose";
import { IEventHandler } from "../handlers/eventHandler";

export default {
	name: 'ready',
	once: true,
	async execute(client: Client) {
		console.log('Connecting to database ...');
		await mongoose.connect(process.env.MONGO_URI || '', { keepAlive: true })
		console.log("Connected !")
        console.log(`Ready! Logged in as ${client.user?.tag}`);
    }
} as IEventHandler