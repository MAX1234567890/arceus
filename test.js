const {BattleStream, getPlayerStreams} = require('./pokemonshowdown/pokemon-showdown/.sim-dist/battle-stream');
const {Dex} = require('./pokemonshowdown/pokemon-showdown/.sim-dist/dex');
const {RandomPlayerAI} = require('./pokemonshowdown/pokemon-showdown/.sim-dist/tools/random-player-ai');
// const {formatText} = require('./ripped_battlechat');
const {exports: exports_} = require('./ripped_battlellog');

/*********************************************************************
 * Run AI
 *********************************************************************/
// tslint:disable:no-floating-promises

const streams = getPlayerStreams(new BattleStream());

const team = [{
    name: "",
    species: "raichu",
    item: "airbaloon",
    ability: "wonderguard",
    moves: ["thunderbolt"],
    nature: "calm",
    gender: "m",
    evs: [0, 0, 0, 0, 0, 0],
    ivs: [31, 31, 31, 31, 31, 31],
    level: 100,
}];

const spec = {
    formatid: "gen7customgame",
};
const p1spec = {
    name: "Bot 1",
    team: Dex.packTeam(team),
};
const p2spec = {
    name: "Bot 2",
    team: Dex.packTeam(Dex.generateTeam('gen7randombattle')),
};

const p1 = new RandomPlayerAI(streams.p1);
const p2 = new RandomPlayerAI(streams.p2);

p1.start();
p2.start();

function toName(stat) {
    return {
        atk: "Attack",
        def: "Defense",
        spa: "Special Attack",
        spd: "Special Defense",
        spe: "Speed"
    }[stat];
}

function output(chunk) {
    let lines = chunk.split("\n");
    for (let line of lines) {
        let info = line.split("|").slice(1);

        if (info[0] === 'switch') {
            let player = info[1].split(' ')[0][1];
            let pokemon = info[1].split(' ')[1];
            console.log(`[P${player}] Go! ${pokemon}!`);
        } else if (info[0] === "faint") {
            let player = info[1].split(' ')[0][1];
            let pokemon = info[1].split(' ')[1];
            console.log(`[P${player}] ${pokemon} fainted!`);
        } else if (info[0] === '-crit') {
            console.log("A critical hit!");
        } else if (info[0] === '-boost' || info[0] === '-unboost') {
            let player = info[1].split(' ')[0][1];
            let pokemon = info[1].split(' ')[1];
            let stat = info[2];
            let stages = info[3] * (info[0] === '-unboost' ? -1 : 1);
            if (stages == 1) {
                console.log(`[P${player}] ${pokemon}'s ${toName(stat)} rose!`);
            } else if (stages == -1) {
                console.log(`[P${player}] ${pokemon}'s ${toName(stat)} fell!`);
            } else if (stages > 1) {
                console.log(`[P${player}] ${pokemon}'s ${toName(stat)} sharply rose!`);
            } else if (stages < -1) {
                console.log(`[P${player}] ${pokemon}'s ${toName(stat)} sharply fell!`);
            }
        } else if (info[0] === '-supereffective') {
            console.log("It's super effective!");
        } else if (info[0] === '-resisted') {
            console.log("It's not very effective.");
        } else if (info[0] === '-immune') {
            let player = info[1].split(' ')[0][1];
            let pokemon = info[1].split(' ')[1];
            console.log(`[P${player}] ${pokemon} is immune.`);
        } else if (info[0] === '-miss') {
            console.log("It missed.");
        } else if (info[0] === '-damage' || info[0] === '-heal') {
            let player = info[1].split(' ')[0][1];
            let pokemon = info[1].split(' ')[1];
            let newhp = info[2].split(' ')[0];

            console.log(`[P${player}] ${pokemon} is on ${newhp}`);
        } else if (info[0] === 'ability') {
            let player = info[1].split(' ')[0][1];
            let pokemon = info[1].split(' ')[1];
            console.log(`[P${player}] (${pokemon}'s !)`);
        } else if (info[0] === 'move') {
            let player = info[1].split(' ')[0][1];
            let pokemon = info[1].split(' ')[1];
            let move = info[2];
            console.log(`[P${player}] ${pokemon} used ${move}!`);
        } else if (info[0] === 'weather') {
            console.log(`The weather is now ${info[1]}!`);
        } else if (info[0] === 'turn') {
            console.log(`\nTurn ${info[1]}\n------${'-'.repeat(Math.floor(Math.log10(+info[1])))}`);
        } else {
            console.log(line);
        }

        // WIN
        // TIE
        // detailschange
        // replace
        // cant
        // fail
        // block
        // sethp
        // status
        // curestatus
        // cureteam
        // setboost
        // swapboost
        // invertboost
        // clearboost
        // clearpositiveboost
        // clearnegativeboost
        // copyboost
        // weather
        // fieldstart
        // fieldend
        // sidestart
        // sideend
        //
    }
}

(async () => {
    let chunk;
    // tslint:disable-next-line no-conditional-assignment
    while ((chunk = await streams.omniscient.read())) {
        // console.log(BattleLog.parseLine(chunk));
        for (let line of chunk.split("\n"))
            console.log(BattleLog.BattleText.parseLine(line));
    }
})();

streams.omniscient.write(`>start ${JSON.stringify(spec)}
>player p1 ${JSON.stringify(p1spec)}
>player p2 ${JSON.stringify(p2spec)}`);