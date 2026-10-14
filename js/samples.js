// A small demo workspace so the app can be tried without uploading anything.

function loadSamples() {
  const docs = [
    {
      name: 'Notes on Spaced Repetition',
      kind: 'md',
      content: `# Notes on Spaced Repetition

Spaced repetition is a learning technique where reviews of a piece of material are scheduled at increasing intervals. Each successful recall pushes the next review further into the future, while a failed recall brings it back to the start.

The method leans on the forgetting curve: memory of new information decays quickly at first and then levels off. Reviewing just before something would be forgotten produces the strongest gain for the least effort.

## Why it works

Retrieval itself strengthens memory. Pulling an answer out of your head is more effective than re-reading it, a finding usually called the testing effect.

Spacing also forces the brain to reconstruct the idea from partial cues, which builds more connections to what you already know.

## In practice

Most tools use flashcards with a scheduling algorithm. The cards should be small: one idea per card, phrased as a question that has a single clear answer.`,
    },
    {
      name: 'Building a Second Brain',
      kind: 'md',
      content: `# Building a Second Brain

A second brain is an external system for capturing, organising and resurfacing ideas. Instead of trusting memory, you store notes where they can be found and recombined later.

## Linking over filing

Folders force every note into exactly one place. Links let a note live in many contexts at once, so ideas from different projects can meet each other.

Over time, a dense web of links becomes more valuable than any single note. Clusters appear around topics you keep returning to, and gaps show where your understanding is thin.

