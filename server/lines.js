/* ============================================================================
   LAST CALL — the dealer's voice
   ----------------------------------------------------------------------------
   The dealer is a disembodied casino announcer with zero sympathy and a mild
   drinking problem. Every line is chosen SERVER-SIDE so that all six people at
   the table laugh at the same joke at the same time. A party game where
   everyone reads a different variation of the same event is not a party game,
   it is six people playing alone.
   ========================================================================== */
'use strict';

const LINES = {
  welcome: [
    'Take a seat. The felt is sticky for reasons we will not be documenting.',
    'Nobody is leaving this table until somebody leaves this table.',
    'House rules: no crying, no lawyers, no refunds. Petty Refund excluded.',
    'You have all signed the thing you did not read. Wonderful.'
  ],
  start: [
    'The house deals. The house always deals.',
    'Somebody loaded this thing and it was not me. Probably.',
    'Let us begin. Statistically, one of you will be extremely fine.'
  ],
  reload: [
    'Fresh magazine. Same bad decisions, new arrangement.',
    'Reloading. Feel free to speculate irresponsibly.',
    'New shells. I have shuffled them, because I am told that is fair.'
  ],
  live: [
    'Live.',
    'That one was real.',
    'Live shell. Ouch.',
    'The gun did the thing it says on the box.'
  ],
  blank: [
    'Blank. Nothing but a loud noise and a memory.',
    'Click. You get to keep all your blood.',
    'Blank. The house thanks you for the suspense.'
  ],
  selfBlank: [
    'Blank on themselves. Bold. Back to you.',
    'A blank to the own face and the turn stays put. Show-off.',
    'They shot themselves, nothing happened, and they get to go again. This is the whole game.'
  ],
  selfLive: [
    'They shot THEMSELVES with a LIVE round. I want that on a shirt.',
    'Self-inflicted. Live. The turn moves on and so does the stretcher.',
    'That is the loudest way to lose an argument.'
  ],
  saw: [
    'Sawed off. The next one hits twice as hard and once as often.',
    'They are filing the barrel. This is not subtle.',
    'Double damage next. Somebody should be worried.'
  ],
  ties: [
    'Bound. They will be sitting the next one out.',
    'Zip ties. Very municipal.',
    'Wrists together. Turn skipped. Everyone say something cruel.'
  ],
  cuffSkip: [
    'Tied up. They flail. It is not dignified. Onwards.',
    'No turn for you. The ties did the talking.'
  ],
  glasses: [
    'They are looking at the shell. Rude, but legal.',
    'Reading glasses. Someone now knows something you do not.'
  ],
  brew: [
    'Courage! A perfectly good shell, wasted on the floor.',
    'They drank it. The chamber spat one out. Everyone look at it.',
    'One shell, publicly ejected. One fewer mystery between you.'
  ],
  refund: [
    'Refund processed. The shell has been... corrected.',
    'They flipped it. What was live is now not. Allegedly.',
    'Petty. Effective. Refunded.'
  ],
  pill: [
    'They took the pill. Crunchy.',
    'Mystery pill. Somewhere a pharmacist sighs.',
    'Down the hatch. We will find out together.'
  ],
  pillGood: ['It was the good one. Two lives. Suspicious.', 'The pill was kind. Deeply out of character.'],
  pillBad: ['It was the bad one. One life, gone.', 'The pill was not kind. The pill was never going to be kind.'],
  burner: [
    'Someone is on the phone. They are getting information. Nobody trusts them now.',
    'Burner phone. A stranger has just told them a secret.'
  ],
  sticky: [
    'Sticky fingers. Property has changed hands. Nothing can be done.',
    'They took something that was not theirs. This is allowed here.'
  ],
  puff: ['They puffed. Life restored. Lung optional.', 'Back from the brink. Cheating, but with a permit.'],
  out: [
    'OUT. Down on the felt with the crumbs.',
    'That is one fewer voice at this table. The rest of you are still extremely at risk.',
    'Eliminated. They may now watch and heckle. That is the entire afterlife.'
  ],
  keeps: [
    'Blank. They keep the turn. The pressure does not leave with them.',
    'Still their turn. Somebody make it stop.'
  ],
  twistMedic: [
    'A roulette medic is in the building. The first corpse this round is merely a deposit.',
    'Medic on call. Die once, die politely, come back annoyed.'
  ],
  twistDouble: [
    'Double or nothing. Live rounds bite twice as deep this round.',
    'The house doubles the damage. The house enjoys itself.'
  ],
  twistRain: [
    'Whiskey rain. Everybody takes an item. No refunds, obviously.',
    'Free items for everyone. This is not generosity, this is chaos administration.'
  ],
  twistSwap: [
    'Musical chairs. The turn order is now a rumour.',
    'I have shuffled the seating of fate. Somebody is definitely annoyed.'
  ],
  twistGolden: [
    'A golden shell is in there somewhere. Kill with it and the house pays double.',
    'One shell wears gold tonight. Murder pays a premium. Think about that.'
  ],
  twistFrenzy: [
    'Frenzy. Half the thinking time, twice the confidence.',
    'The clock is drunk this round. Decide faster.'
  ],
  twistLights: [
    'Lights down. For atmosphere. And for deniability.',
    'Somebody dimmed the room. Nobody will admit it.'
  ],
  revive: [
    'The medic drags them back over the line. Welcome back. Sit down.',
    'Stitch, staple, shove. They are alive again and they are furious.'
  ],
  over: [
    'And the house declares a survivor. Congratulations, sort of.',
    'One of you is still standing. The rest of you are furniture now.'
  ]
};

/* Pick a line and remember the last few so the same joke does not repeat. */
function makeDealer(rng) {
  const history = {};
  return function dealer(key) {
    const pool = LINES[key];
    if (!pool || !pool.length) return null;
    const seen = history[key] || (history[key] = []);
    for (let attempt = 0; attempt < 24; attempt++) {
      const line = pool[Math.floor(rng() * pool.length)];
      if (!seen.includes(line) || seen.length >= pool.length - 1) {
        seen.push(line);
        while (seen.length > Math.max(1, Math.ceil(pool.length * 0.6))) seen.shift();
        return line;
      }
    }
    return pool[0];
  };
}

/* Flavour text for the bot seats, so the empty chairs still feel like people. */
const BOT_NAMES = [
  'Vinny Three-Coats', 'Dot Matrix', 'Big Rhonda', 'Sad Paul', 'The Accountant',
  'Marbles', 'Aunt Vengeance', 'Kip', 'Delores Nine-Knives', 'Bartholomew',
  'Sheila From Work', 'Gravy', 'Nine-Fingered Nino', 'Peg', 'The Intern',
  'Chuck', 'Wanda', 'Frosty Pete', 'Mother', 'Bram'
];

const BOT_AVATARS = ['fedora', 'shades', 'moustache', 'cigarette', 'moth', 'cat', 'skull', 'cactus', 'toucan', 'toaster'];

module.exports = { LINES, makeDealer, BOT_NAMES, BOT_AVATARS };
