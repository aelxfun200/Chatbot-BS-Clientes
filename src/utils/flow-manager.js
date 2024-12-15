import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { format } from 'date-fns';
import { initializeOpenAI } from './openai.js';

// File paths
const DATA_DIR = join(process.cwd(), 'data');
const MODIFICATIONS_FILE = join(DATA_DIR, 'modifications.txt');
const HISTORY_FILE = join(DATA_DIR, 'history.txt');
const PROMPT_FILE = join(DATA_DIR, 'current_prompt.txt');

// Initialize data files and directories
export const initializeDataFiles = async () => {
    // Create data directory if it doesn't exist
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR);
    }

    // Create files if they don't exist
    const files = [
        { path: MODIFICATIONS_FILE, content: '' },
        { path: HISTORY_FILE, content: '' },
        {
            path: PROMPT_FILE,
            content: `You are a specialized chatbot for a pool construction company.
Your role is to gather information about potential clients' pool projects.
Maintain a professional yet friendly tone.

Required information to gather:
- Contact information (name, phone)
- Property details (address, plot size)
- Pool specifications (dimensions, materials)
- Access requirements for machinery

Guidelines:
1. Keep responses concise and clear
2. Ask for one piece of information at a time
3. Confirm information when received
4. Be helpful and patient
5. Maintain a natural conversation flow`
        }
    ];

    for (const file of files) {
        if (!existsSync(file.path)) {
            writeFileSync(file.path, file.content);
        }
    }
};

// Read current modifications
export const readModifications = () => {
    try {
        return readFileSync(MODIFICATIONS_FILE, 'utf-8')
            .split('\n')
            .filter(Boolean);
    } catch {
        return [];
    }
};

// Write a new modification
export const writeModification = async (modification) => {
    const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
    const entry = `[${timestamp}] ${modification}\n`;
    
    // Append to both files
    appendFileSync(MODIFICATIONS_FILE, entry);
    appendFileSync(HISTORY_FILE, entry);
    
    // Check if we need to generate new prompt
    const modifications = readModifications();
    if (modifications.length >= 10) {
        await generateNewPrompt(modifications);
    }
};

// Generate new prompt based on modifications
const generateNewPrompt = async (modifications) => {
    try {
        const openai = initializeOpenAI();
        const currentPrompt = readFileSync(PROMPT_FILE, 'utf-8');
        
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are an AI that improves chatbot prompts based on user feedback and modifications."
                },
                {
                    role: "user",
                    content: `Current prompt:\n${currentPrompt}\n\nUser modifications:\n${modifications.join('\n')}\n\nCreate an improved prompt that incorporates these modifications while maintaining the core functionality.`
                }
            ]
        });

        const newPrompt = response.choices[0].message.content;
        writeFileSync(PROMPT_FILE, newPrompt);
        writeFileSync(MODIFICATIONS_FILE, ''); // Clear modifications
        
        return newPrompt;
    } catch (error) {
        console.error('Error generating new prompt:', error);
        return null;
    }
};

// Detect modification intent
export const detectModificationIntent = async (message) => {
    try {
        const openai = initializeOpenAI();
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You analyze messages to detect chatbot modification requests. Respond with JSON containing 'isModification' (boolean) and 'description' (string describing the modification if detected)."
                },
                {
                    role: "user",
                    content: message
                }
            ]
        });

        return JSON.parse(response.choices[0].message.content);
    } catch (error) {
        console.error('Error detecting modification:', error);
        return { isModification: false, description: null };
    }
};

// Simulate conversation
export const simulateConversation = async (message, context) => {
    try {
        const openai = initializeOpenAI();
        const basePrompt = readFileSync(PROMPT_FILE, 'utf-8');
        
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: basePrompt
                },
                ...context,
                {
                    role: "user",
                    content: message
                }
            ]
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error('Error simulating conversation:', error);
        return "Lo siento, ha ocurrido un error en la simulación.";
    }
};