import { addKeyword } from '@builderbot/bot'
import { OpenAI } from 'openai'
import dotenv from 'dotenv'
import { DynamoDBService } from '../services/dynamodb.js'
import { createReadStream } from 'fs'

// Inicializar variables de entorno
dotenv.config()

// Inicializar OpenAI
const apiKey = process.env.OPENAI_API_KEY
const openai = new OpenAI({ apiKey })

// Inicializar el servicio de DynamoDB
const dynamoService = new DynamoDBService()

// Constantes
// NOTA: Para que funcione correctamente con addKeyword,
// se recomienda un arreglo con la expresión regular.
const REGEX_ANY_CHARACTER = [/^.+$/]

// Función mejorada de logging
const logInfo = (context, message, data = null) => {
    const timestamp = new Date().toISOString()
    console.log(`\n[${timestamp}] [${context}]`)
    console.log(`Mensaje: ${message}`)
    if (data) {
        console.log('Datos:', JSON.stringify(data, null, 2))
    }
    console.log('-'.repeat(80))
}

// Función para procesar mensajes de audio
const processAudioMessage = async (ctx, provider) => {
    try {
        const localPath = await provider.saveFile(ctx, { path: 'voice_notes' })
        console.log('Ruta local del archivo de audio:', localPath)

        const audioData = createReadStream(localPath)
        const transcribeResponse = await openai.audio.transcriptions.create({
            file: audioData,
            model: 'whisper-1',
        })
        
        return transcribeResponse.text
    } catch (error) {
        logInfo('processAudioMessage', 'Error al procesar el mensaje de audio', { error: error.message })
        return null
    }
}

// Función auxiliar para manejar mensajes (texto o voz)
const handleMessage = async (ctx, provider) => {
    if (ctx.message?.audioMessage || ctx.message?.messageContextInfo?.messageContent?.audioMessage) {
        try {
            const transcript = await processAudioMessage(ctx, provider)
            return transcript
        } catch (error) {
            console.error('Error al procesar el audio:', error)
            return null
        }
    }
    return ctx.body
}

// Función para generar un nuevo prompt basado en modificaciones
const generateNewPrompt = async (modifications) => {
    try {
        const currentPrompt = await dynamoService.getPrompt()

        // Convertimos la lista de modificaciones en un texto
        // Útil si deseas mostrar "Tipo: x, Descripción: y", etc.
        const modificationsText = modifications
            .map(m => `Tipo: ${m.modification_type}\nDescripción: ${m.description}`)
            .join('\n\n')

        const completion = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                {
                    role: 'system',
                    content: 'Eres una IA que mejora los prompts de chatbots basándose en el feedback y modificaciones de los usuarios.'
                },
                {
                    role: 'user',
                    content: `Prompt actual:\n${currentPrompt}\n\nModificaciones a incorporar:\n${modificationsText}\n\nCrea un prompt mejorado que incorpore estas modificaciones manteniendo la funcionalidad principal.Importante siempre al final del prompt añade esta frase-     Estos son los datos actualizados al día de hoy del restaurante:`
                }
            ],
            temperature: 0.7
        })

        const newPrompt = completion.choices[0].message.content
        await dynamoService.updatePrompt(newPrompt)

        logInfo('generateNewPrompt', 'Nuevo prompt generado', { newPrompt })
        return newPrompt
    } catch (error) {
        logInfo('generateNewPrompt', 'Error al generar el nuevo prompt', { error: error.message })
        return null
    }
}

// Función para analizar la conversación en busca de modificaciones
const analyzeForModifications = async (conversation) => {
    try {
        logInfo('analyzeForModifications', 'Analizando la conversación para modificaciones')

        // Convertimos la conversación en un string
        const conversationText = conversation
            .map(msg => `${msg.role}: ${msg.content}`)
            .join('\n')

        // Instrucciones específicas para que OpenAI devuelva JSON válido
        const prompt = `\nConversación:\n${conversationText}\n\nPor favor, analiza la conversación anterior y determina si hay sugerencias para mejorar el chatbot. Responde exclusivamente con un objeto JSON que contenga las siguientes propiedades: 'is_modification' (booleano). Si 'is_modification' es verdadero, incluye también 'modification_type' (cadena) y 'description' (cadena). No incluyas ningún otro texto.`

        const completion = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: conversation[conversation.length - 1].content }
            ],
            temperature: 0.3
        })

        const responseContent = completion.choices[0].message.content.trim()
        logInfo('analyzeForModifications', 'Respuesta de la IA', { responseContent })

        return JSON.parse(responseContent)
    } catch (error) {
        logInfo('analyzeForModifications', 'Error al analizar modificaciones', { error: error.message })
        // Si hay error, retornamos por defecto que no hay modificación
        return { is_modification: false }
    }
}

// Función para guardar una modificación
// Nota: la lógica para generar un nuevo prompt y limpiar las modificaciones
// se realiza aquí, luego de guardar la modificación.
const saveModification = async (modification) => {
    // Guardamos la nueva modificación
    await dynamoService.saveModification(modification)

    // Obtenemos la lista actualizada de modificaciones
    const modifications = await dynamoService.getModifications()

    // Si hay 3 o más, generamos el nuevo prompt y limpiamos las modificaciones
    if (modifications.length >= 3) {
        await generateNewPrompt(modifications)
        // Limpiar la lista de modificaciones en DynamoDB
        await dynamoService.clearModifications()
    }
}

// Función para generar la siguiente interacción en la conversación
const getNextInteraction = async (conversation) => {
    try {
        logInfo('getNextInteraction', 'Obteniendo la siguiente respuesta del bot')

        const basePrompt = await dynamoService.getPrompt()
        const conversationHistory = conversation
            .map(msg => `${msg.role}: ${msg.content}`)
            .join('\n')

        const prompt = `${basePrompt}\nHistorial de la conversación:\n${conversationHistory}`

        const completion = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                { role: 'system', content: prompt },
                ...conversation
            ],
            temperature: 0.7
        })

        return completion.choices[0].message.content
    } catch (error) {
        logInfo('getNextInteraction', 'Error al obtener la respuesta', { error: error.message })
        return 'Lo siento, ha ocurrido un error. ¿Podrías repetir tu mensaje?'
    }
}

// Exportación principal del flujo
export const flowTraining = addKeyword(REGEX_ANY_CHARACTER, { regex: true })
    .addAction(async (ctx, { flowDynamic, state, provider }) => {
        try {
            // Verificamos si ya estamos en modo de entrenamiento
            let isInTraining = state.get('isInTraining')
            const message = await handleMessage(ctx, provider)

            if (!message) {
                await flowDynamic('Hubo un error al procesar el mensaje. Por favor, intenta nuevamente.')
                return
            }

            // Verificar si se está iniciando el entrenamiento
            if (!isInTraining) {
                if (message.toLowerCase() === 'entrenar') {
                    // Activamos el modo de entrenamiento y reiniciamos la conversación en memoria
                    await state.update({ isInTraining: true, conversation: [] })
                    await flowDynamic([
                        '🤖 *Modo de Entrenamiento Iniciado*',
                        '',
                        'Puedes interactuar normalmente con el bot o sugerir modificaciones.',
                        'Para salir, simplemente escribe "salir".',
                        '',
                        '¿En qué puedo ayudarte?'
                    ])
                    return
                }
                // Si no entra la palabra clave "entrenar", no estamos en entrenamiento
                return false
            }

            // Verificar comando de salida
            if (message.toLowerCase() === 'salir') {
                await flowDynamic([
                    '✅ Entrenamiento finalizado.',
                    'Todas las modificaciones han sido guardadas.',
                    '¡Hasta pronto!'
                ])
                // Limpiamos todo el estado (modo de entrenamiento y conversación)
                await state.clear()
                return
            }

            // Obtener o inicializar el contexto de la conversación
            let conversation = state.get('conversation') || []
            conversation.push({ role: 'user', content: message })

            // Analizar la conversación para modificaciones
            const analysis = await analyzeForModifications(conversation)

            if (analysis.is_modification) {
                logInfo('flowTraining', 'Modificación detectada', analysis)
                await saveModification(analysis)

                await flowDynamic([
                    '✅ He detectado una sugerencia de modificación:',
                    `**Tipo:** ${analysis.modification_type}`,
                    `**Descripción:** ${analysis.description}`,
                    '',
                    'La modificación ha sido registrada. ¿Hay algo más en lo que pueda ayudarte?'
                ])

                // Añadimos la respuesta del bot al estado de la conversación
                conversation.push({
                    role: 'assistant',
                    content: `Modificación registrada: ${analysis.description}`
                })

                // Actualizar el estado de la conversación
                await state.update({ conversation })
                return
            } else {
                // Flujo normal de conversación
                const response = await getNextInteraction(conversation)
                await flowDynamic(response)
                conversation.push({ role: 'assistant', content: response })
            }

            // Actualizar el estado de la conversación
            await state.update({ conversation })

        } catch (error) {
            logInfo('flowTraining', 'Error en el flujo', { error: error.message })
            await flowDynamic('Ha ocurrido un error. Por favor, intenta de nuevo.')
        }
    })
