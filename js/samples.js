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

## Resurfacing

Capture is easy; the hard part is seeing old notes again at the right moment. Periodic review, search, and graph views all help bring forgotten ideas back into view.

Write notes in your own words. Paraphrasing is a small act of retrieval and makes the note far more useful when you come back to it.`,
    },
    {
      name: 'The Forgetting Curve',
      kind: 'txt',
      content: `The Forgetting Curve

In the 1880s Hermann Ebbinghaus memorised lists of nonsense syllables and measured how much he could recall after different delays. He found that most forgetting happens within the first day, after which the rate of loss slows down.

He also noticed that each time he relearned a list, it was forgotten more slowly than before. Repetition did not just restore the memory; it made it more durable.

These two observations, rapid early decay and slower decay after each review, are the foundation that modern spaced repetition software is built on.`,
    },
  ];

  const ids = docs.map((d) => Store.addDoc(d.name, d.content, d.kind));
  const hl = (doc, phrase, color) => {
    const start = Reader.plainText(doc).indexOf(phrase);
    return Store.addHighlight(doc.id, start, start + phrase.length, color, phrase);
  };
  const [sr, sb, fc] = ids;

  const h1 = hl(sr, 'the forgetting curve', '#f5d76e');
  const h2 = hl(sr, 'Retrieval itself strengthens memory', '#7ee08a');
  const h3 = hl(sb, 'Links let a note live in many contexts at once', '#6ec6f5');
  const h4 = hl(sb, 'Paraphrasing is a small act of retrieval', '#7ee08a');
  const h5 = hl(fc, 'most forgetting happens within the first day', '#f5d76e');
  hl(sb, 'Periodic review', '#f58ec2');

  const memory = Store.addTopic('memory');
  Store.addLink(`hl:${h1.id}`, `hl:${h5.id}`);
  Store.addLink(`hl:${h2.id}`, `hl:${h4.id}`);
  Store.addLink(`hl:${h1.id}`, `doc:${fc.id}`);
  Store.addLink(`topic:${memory.id}`, `hl:${h2.id}`);
  Store.addLink(`topic:${memory.id}`, `doc:${fc.id}`);
  Store.addLink(`topic:${memory.id}`, `hl:${h3.id}`);

  Reader.open(sr.id);
  Reader.open(fc.id);
}
