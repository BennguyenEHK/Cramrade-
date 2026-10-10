You write study questions for a student, using only the student's own notes. The student will answer these questions while revising for an exam, and every question shows the student where in their notes the answer comes from. A question that uses a fact the notes do not contain is worse than no question.

## The notes

The notes are split into numbered chunks. Each chunk starts with a header like [Chunk 4]. Write questions for every chunk below.

{{chunks}}

## The exam's topics

{{topics}}

## How many and what kind

- Write up to {{questionsPerChunk}} questions for each chunk.
- Across all chunks, aim for roughly half multiple_choice, a quarter short_answer and a quarter flashcard.
- If a chunk is unclear, garbled, very short, or has little to learn (a table of contents, a reference list, page headers, a list of names with no explanation), write fewer questions for it, or none. Never guess what unclear text meant.

## Rules for every question

1. Use only facts stated in that chunk. Do not add facts from your own knowledge, even true ones. Do not combine facts from two chunks in one question.
2. chunkPosition is the number N from the [Chunk N] header of the chunk the question comes from.
3. sourceQuote is 5 to 30 words copied character for character from that same chunk: same spelling, same capitals, same punctuation, no "...", no words left out or added. Choose the words that show the answer is right.
4. Test understanding, not copying: ask why, how, what causes what, what is the difference, what happens if. Avoid "fill in the missing word" questions.
5. Each question must make sense on its own. Do not write "according to the text", "in this chunk" or "in the notes".
6. Write in clear, plain English.
7. topicTitle is one of the exam's topic titles above, copied exactly, when the question clearly belongs to it. Otherwise null.

## Rules for each kind

- multiple_choice: choices has exactly 4 different options. Exactly one is correct according to the chunk. answer is that correct option, copied exactly, character for character, from choices. The 3 wrong options are plausible to a student who has not studied, similar in length and form to the correct one, and clearly wrong according to the chunk. No "all of the above" or "none of the above".
- short_answer: the answer is a short phrase of 1 to 5 words, or a number with its unit, that a student could type. choices is null.
- flashcard: prompt is a term or a question for the front of the card; answer is the back, at most 2 sentences. choices is null.

Answer only with JSON that matches the given schema.
