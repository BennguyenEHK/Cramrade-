// Fill {{placeholders}} in a prompt file. Pure, so vitest can test it.

export type PromptValue = string | number | boolean | null | object;

/**
 * Replace every {{name}} in template with variables[name]. Strings go in as
 * they are; anything else goes in as pretty JSON. A placeholder with no value
 * throws, so a prompt never reaches the AI with a hole in it. Extra variables
 * are ignored.
 */
export function fillPrompt(template: string, variables: Record<string, PromptValue>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new Error(`prompt placeholder {{${name}}} has no value`);
    }
    const value = variables[name];
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  });
}
