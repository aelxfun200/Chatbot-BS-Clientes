import { OpenAI } from 'openai';

let openaiInstance = null;

export const initializeOpenAI = () => {
    if (!openaiInstance) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is required in environment variables');
        }

        openaiInstance = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }

    return openaiInstance;
};