import { addKeyword, EVENTS } from '@builderbot/bot';
import { OpenAI } from 'openai';
import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync, createReadStream } from 'fs';
import { join } from 'path';
import { format } from 'date-fns';
import dotenv from 'dotenv';
import { log } from 'console';
import { toAsk } from "@builderbot-plugins/openai-assistants";



// Initialize environment variables
dotenv.config();
// Initialize OpenAI
const apiKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey });

// File paths
const DATA_DIR = join(process.cwd(), 'data');
const MODIFICATIONS_FILE = join(DATA_DIR, 'modifications.txt');
const HISTORY_FILE = join(DATA_DIR, 'history.txt');
const PROMPT_FILE = join(DATA_DIR, 'current_prompt.txt');
const HISTORY_PROMPT_FILE = join(DATA_DIR, 'history_prompt.txt');


// Prompts paths
const PROMPT_DIR = join(process.cwd(), 'src/prompts');
const MODIFICATION_PROMPT_DIR = join(PROMPT_DIR, 'analizador_modificaciones.txt');
const NEXT_ITERATION_PROMPT = join(PROMPT_DIR, 'next_iteration_prompt.txt');

// Audio paths
const AUDIO_DIR = join(process.cwd(), 'voice_notes');

// Constants
const REGEX_ANY_CHARACTER = '/^.+$/';


// Enhanced logging function
const logInfo = (context, message, data = null) => {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] [${context}]`);
    console.log(`Message: ${message}`);
    if (data) {
        console.log('Data:', JSON.stringify(data, null, 2));
    }
    console.log('-'.repeat(80));
};


// Function to obtain the prompt required

const getPrompt = async (requested_prompt) => {
    try {
        const text = readFileSync(requested_prompt, 'utf-8')
        logInfo(text);

        return text;
    } catch (error) {
        console.error('Error al leer el prompt:', error);
        return null;
    }
};


// Function to process audio messages
const processAudioMessage = async (ctx, provider) => {
    try {
        const localPath = await provider.saveFile(ctx, { path: AUDIO_DIR });
        console.log('Ruta del archivo de audio local:', localPath);

        // Leer el archivo de audio
        const audioData = createReadStream(localPath);

        // Transcribir el audio usando OpenAI
        const transcribeResponse = await openai.audio.transcriptions.create({
            file: audioData,
            model: 'whisper-1',
        });
        const transcription = transcribeResponse.text;
        console.log('Respuesta del asistente de OpenAI:', transcription);

        return transcription;

    } catch (error) {
        logInfo('processAudioMessage', 'Error processing audio message', { error: error.message });
        return null;
    }
};

// Función auxiliar para manejar mensajes (texto o voz)
const handleMessage = async (ctx, provider) => {
    
    // Si es un mensaje de voz
    if (ctx.message?.audioMessage || ctx.message?.messageContextInfo?.messageContent?.audioMessage) {
        try {
            const transcript = processAudioMessage(ctx, provider);
            return transcript;
        } catch (error) {
            console.error('Error procesando audio:', error);
            return null;
        }
    }
    // Si es un mensaje de texto
    return ctx.body;
};

// Function to generate new prompt based on modifications
const generateNewPrompt = async (modifications) => {
    try {
        const currentPrompt = readFileSync(PROMPT_FILE, 'utf-8');

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are an AI that improves chatbot prompts based on user feedback and modifications."
                },
                {
                    role: "user",
                    content: `Current prompt:\n${currentPrompt}\n\nModifications to incorporate:\n${modifications.join('\n')}\n\nCreate an improved prompt that incorporates these modifications while maintaining the core functionality.`
                }
            ],
            temperature: 0.7
        });

        const newPrompt = completion.choices[0].message.content;
        writeFileSync(PROMPT_FILE, ''); // clear previous prompt
        appendFileSync(PROMPT_FILE, newPrompt);
        appendFileSync(HISTORY_PROMPT_FILE, newPrompt);
        writeFileSync(MODIFICATIONS_FILE, ''); // Clear modifications

        logInfo('generateNewPrompt', 'Generated new prompt', { newPrompt });
        return newPrompt;
    } catch (error) {
        logInfo('generateNewPrompt', 'Error generating new prompt', { error: error.message });
        return null;
    }
};

// Function to analyze conversation for modifications
const analyzeForModifications = async (conversation) => {
    try {
        logInfo('analyzeForModifications', 'Analyzing conversation for modifications');

        const text_prompt = await getPrompt(MODIFICATION_PROMPT_DIR);
        const prompt = `\nConversación: ${conversation.map(msg => `${msg.role}: ${msg.content}`).join('\n')}${text_prompt}`; // Combina text_prompt y la conversación

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: conversation[conversation.length - 1].content }
            ],
            temperature: 0.3
        });

        return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
        logInfo('analyzeForModifications', 'Error analyzing modifications', { error: error.message });
        return { is_modification: false };
    }
};

// Function to save modification
const saveModification = async (modification) => {
    const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
    const entry = `[${timestamp}] ${JSON.stringify(modification)}\n`;

    appendFileSync(MODIFICATIONS_FILE, entry);
    appendFileSync(HISTORY_FILE, entry);

    const modifications = readFileSync(MODIFICATIONS_FILE, 'utf-8').split('\n').filter(Boolean);
    if (modifications.length >= 3) {
        await generateNewPrompt(modifications);
    }
};

// Function to generate conversation response
const getNextInteraction = async (conversation) => {
    try {
        logInfo('getNextInteraction', 'Getting next bot response');

        const basePrompt = readFileSync(PROMPT_FILE, 'utf-8');
        const text_prompt = await getPrompt(NEXT_ITERATION_PROMPT);
        const prompt = `${basePrompt}${text_prompt}\nHistorial de la conversación: ${conversation.map(msg => `${msg.role}: ${msg.content}`).join('\n')}`; // Combina text_prompt y la conversación

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: prompt },
                ...conversation
            ],
            temperature: 0.7
        });

        return completion.choices[0].message.content;
    } catch (error) {
        logInfo('getNextInteraction', 'Error getting response', { error: error.message });
        return "Lo siento, ha ocurrido un error. ¿Podrías repetir tu mensaje?";
    }
};

// Asegúrate de que el directorio existe
if (!existsSync(AUDIO_DIR)) {
    mkdirSync(AUDIO_DIR, { recursive: true });
    console.log(`Directorio creado: ${AUDIO_DIR}`);
}

// Main flow export
export const flowTraining = addKeyword(REGEX_ANY_CHARACTER, { regex: true })
    .addAction(async (ctx, { flowDynamic, state, provider }) => {
        try {
            //const message = ctx.body;
            let isInTraining = state.get('isInTraining');

            const message = await handleMessage(ctx, provider);

            if (!message) {
                await flowDynamic('Hubo un error al procesar el mensaje. Por favor, intenta nuevamente.');
                return;
            }

            //console.log('+'.repeat(50) + message);

            // Check if starting training
            if (!isInTraining) {
                if (message.toLowerCase() === 'entrenar') {
                    await state.update({ isInTraining: true });
                    await flowDynamic([
                        '🤖 *Modo de Entrenamiento Iniciado*',
                        '',
                        'Puedes interactuar normalmente con el bot o sugerir modificaciones.',
                        'Para salir, simplemente escribe "salir".',
                        '',
                        '¿En qué puedo ayudarte?'
                    ]);
                    return;
                }
                return false; // Not in training, allow other flows
            }

            // Check for exit command
            if (message.toLowerCase() === 'salir') {
                await flowDynamic([
                    '✅ Entrenamiento finalizado.',
                    'Todas las modificaciones han sido guardadas.',
                    '¡Hasta pronto!'
                ]);
                await state.clear();
                return;
            }

            // Get or initialize conversation context
            let conversation = state.get('conversation') || [];
            conversation.push({ role: 'user', content: message });

            // Analyze for modifications
            const analysis = await analyzeForModifications(conversation);

            if (analysis.is_modification) {
                logInfo('flowTraining', 'Modification detected', analysis);
                await saveModification(analysis);

                await flowDynamic([
                    '✅ He detectado una sugerencia de modificación:',
                    `Tipo: ${analysis.modification_type}`,
                    `Descripción: ${analysis.description}`,
                    '',
                    'La modificación ha sido registrada. ¿Hay algo más en lo que pueda ayudarte?'
                ]);

                conversation.push({
                    role: 'assistant',
                    content: `Modificación registrada: ${analysis.description}`
                });

                return;
            } else {
                // Normal conversation flow
                const response = await getNextInteraction(conversation);
                await flowDynamic(response);
                conversation.push({ role: 'assistant', content: response });
            }

            // Update conversation state
            await state.update({ conversation });

        } catch (error) {
            logInfo('flowTraining', 'Error in flow', { error: error.message });
            await flowDynamic('Ha ocurrido un error. Por favor, intenta de nuevo.');
        }
    });

