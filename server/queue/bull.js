// server/queue/bull.js
import { Queue, QueueEvents } from "bullmq";
import { ENV } from "../config/env.js";
import { BULL_QUEUE_NAME } from "../config/constants.js";

export const connection = { host: ENV.REDIS_HOST, port: ENV.REDIS_PORT };
export const queue = new Queue(BULL_QUEUE_NAME, { connection });
export const queueEvents = new QueueEvents(BULL_QUEUE_NAME, { connection });