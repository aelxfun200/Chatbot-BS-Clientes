import { appendFileSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const rutaAnotaciones = join(process.cwd(), 'anotaciones.txt');
const rutaHistorial = join(process.cwd(), 'historial_anotaciones.txt');
const rutaPrompts = join(process.cwd(), 'src/prompts');

// Guarda una anotación en el archivo de anotaciones recientes
export const guardarAnotacion = (texto) => {
    try {
        appendFileSync(rutaAnotaciones, `${new Date().toISOString()} - ${texto}\n`);
    } catch (error) {
        console.error('Error guardando la anotación:', error);
    }
};

// Guarda una anotación en el historial completo
export const guardarEnHistorial = (texto) => {
    try {
        appendFileSync(rutaHistorial, `${new Date().toISOString()} - ${texto}\n`);
    } catch (error) {
        console.error('Error guardando en el historial:', error);
    }
};

// Genera un nuevo prompt basado en las anotaciones recientes
export const generarNuevoPrompt = () => {
    try {
        const anotaciones = readFileSync(rutaAnotaciones, 'utf-8').split('\n').filter(Boolean);
        if (anotaciones.length >= 10) { // Por ejemplo, después de 10 anotaciones
            const nuevoPrompt = anotaciones.join('\n');
            const nombrePrompt = `modificado_${Date.now()}.txt`;

            writeFileSync(join(rutaPrompts, nombrePrompt), nuevoPrompt);
            writeFileSync(rutaAnotaciones, ''); // Limpia el archivo de anotaciones
            return nombrePrompt;
        }
        return null;
    } catch (error) {
        console.error('Error generando nuevo prompt:', error);
        return null;
    }
};

// Lee el archivo de anotaciones recientes
export const leerAnotaciones = () => {
    try {
        return readFileSync(rutaAnotaciones, 'utf-8');
    } catch (error) {
        console.error('Error leyendo anotaciones:', error);
        return '';
    }
};
