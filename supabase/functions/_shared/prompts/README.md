# Prompts

One Markdown file per AI job: `read-syllabus.md`, `make-questions.md`, `rate-difficulty.md`. `askGemini('<name>', variables, schema)` in `../ai.ts` reads `<name>.md` and replaces every `{{placeholder}}` with the matching variable. A placeholder with no variable is an error, so a prompt never reaches the AI with a hole in it.

A function that uses a prompt must ship it: add `static_files = ["./functions/_shared/prompts/<name>.md"]` to that function's block in `supabase/config.toml`.

Prompts are English. They tell the AI to use only the text it is given and never to add facts.
