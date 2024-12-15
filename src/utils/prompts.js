import { readFileSync } from 'fs';
import { join } from 'path';

export const leerPrompt = () => {
    const rutaPrompt = join(process.cwd(), 'src/prompts/default.txt');
    return readFileSync(rutaPrompt, 'utf-8');
};
