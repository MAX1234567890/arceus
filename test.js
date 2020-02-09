const {BattleStream, getPlayerStreams} = require('./pokemonshowdown/pokemon-showdown/.sim-dist/battle-stream');
const {Dex} = require('./pokemonshowdown/pokemon-showdown/.sim-dist/dex');
const {RandomPlayerAI} = require('./pokemonshowdown/pokemon-showdown/.sim-dist/tools/random-player-ai');
const _battlestream = require('./pokemonshowdown/pokemon-showdown/.sim-dist/battle-stream');
const _prng = require('./pokemonshowdown/pokemon-showdown/.sim-dist/prng');

const readline = require('readline');

/*********************************************************************
 * Run AI
 *********************************************************************/
// tslint:disable:no-floating-promises

const streams = getPlayerStreams(new BattleStream());

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }))
}


class TextPlayer extends _battlestream.BattlePlayer {
    constructor(
        playerStream,
        options = {},
        debug = false
    ) {
        super(playerStream, debug);
        this.move = options.move || 1.0;
        this.mega = options.mega || 0;
        this.prng = options.seed && !Array.isArray(options.seed) ? options.seed : new (0, _prng.PRNG)(options.seed);
        this.result = undefined;
    }

    receiveError(error) {
        // If we made an unavailable choice we will receive a followup request to
        // allow us the opportunity to correct our decision.
        if (error.message.startsWith('[Unavailable choice]')) return;
        throw error;
    }

    receiveRequest(request) {
        if (request.wait) {
            // wait request
            // do nothing
        } else if (request.forceSwitch) {
            // switch request
            const pokemon = request.side.pokemon;
            const chosen = [];
            const choices = request.forceSwitch.map((mustSwitch) => {
                if (!mustSwitch) return `pass`;

                const canSwitch = [1, 2, 3, 4, 5, 6].filter(i => (
                    pokemon[i - 1] &&
                    // not active
                    i > request.forceSwitch.length &&
                    // not chosen for a simultaneous switch
                    !chosen.includes(i) &&
                    // not fainted
                    !pokemon[i - 1].condition.endsWith(` fnt`)
                ));

                if (!canSwitch.length) return `pass`;
                const target = this.chooseSwitch(
                    canSwitch.map(slot => ({slot, pokemon: pokemon[slot - 1]})));
                chosen.push(target);
                return `switch ${target}`;
            });

            this.choose(choices.join(`, `));
        } else if (request.active) {
            // move request
            let [canMegaEvo, canUltraBurst, canZMove] = [true, true, true];
            const pokemon = request.side.pokemon;
            const chosen = [];
            const choices = request.active.map((active, i) => {
                if (pokemon[i].condition.endsWith(` fnt`)) return `pass`;

                canMegaEvo = canMegaEvo && active.canMegaEvo;
                canUltraBurst = canUltraBurst && active.canUltraBurst;
                canZMove = canZMove && !!active.canZMove;

                let canMove = [1, 2, 3, 4].slice(0, active.moves.length).filter(j => (
                    // not disabled
                    !active.moves[j - 1].disabled
                    // NOTE: we don't actually check for whether we have PP or not because the
                    // simulator will mark the move as disabled if there is zero PP and there are
                    // situations where we actually need to use a move with 0 PP (Gen 1 Wrap).
                )).map(j => ({
                    slot: j,
                    move: active.moves[j - 1].move,
                    target: active.moves[j - 1].target,
                    zMove: false,
                }));
                if (canZMove) {
                    canMove.push(...[1, 2, 3, 4].slice(0, active.canZMove.length)
                        .filter(j => active.canZMove[j - 1])
                        .map(j => ({
                            slot: j,
                            move: active.canZMove[j - 1].move,
                            target: active.canZMove[j - 1].target,
                            zMove: true,
                        })));
                }

                // Filter out adjacentAlly moves if we have no allies left, unless they're our
                // only possible move options.
                const hasAlly = pokemon.length > 1 && !pokemon[i ^ 1].condition.endsWith(` fnt`);
                const filtered = canMove.filter(m => m.target !== `adjacentAlly` || hasAlly);
                canMove = filtered.length ? filtered : canMove;

                const moves = canMove.map(m => {
                    let move = `move ${m.slot}`;
                    // NOTE: We don't generate all possible targeting combinations.
                    if (request.active.length > 1) {
                        if ([`normal`, `any`, `adjacentFoe`].includes(m.target)) {
                            move += ` ${1 + Math.floor(this.prng.next() * 2)}`;
                        }
                        if (m.target === `adjacentAlly`) {
                            move += ` -${(i ^ 1) + 1}`;
                        }
                        if (m.target === `adjacentAllyOrSelf`) {
                            if (hasAlly) {
                                move += ` -${1 + Math.floor(this.prng.next() * 2)}`;
                            } else {
                                move += ` -${i + 1}`;
                            }
                        }
                    }
                    if (m.zMove) move += ` zmove`;
                    return {choice: move, move: m};
                });

                const canSwitch = [1, 2, 3, 4, 5, 6].filter(j => (
                    pokemon[j - 1] &&
                    // not active
                    !pokemon[j - 1].active &&
                    // not chosen for a simultaneous switch
                    !chosen.includes(j) &&
                    // not fainted
                    !pokemon[j - 1].condition.endsWith(` fnt`)
                ));
                const switches = active.trapped ? [] : canSwitch;

                if (switches.length && (!moves.length || this.prng.next() > this.move)) {
                    const target = this.chooseSwitch(
                        canSwitch.map(slot => ({slot, pokemon: pokemon[slot - 1]})));
                    chosen.push(target);
                    return `switch ${target}`;
                } else if (moves.length) {
                    const move = this.chooseMove(moves);
                    if (move.endsWith(` zmove`)) {
                        canZMove = false;
                        return move;
                    } else if ((canMegaEvo || canUltraBurst) && this.prng.next() < this.mega) {
                        if (canMegaEvo) {
                            canMegaEvo = false;
                            return `${move} mega`;
                        } else {
                            canUltraBurst = false;
                            return `${move} ultra`;
                        }
                    } else {
                        return move;
                    }
                } else {
                    throw new Error(`${this.constructor.name} unable to make choice ${i}. request='${request}',` +
                        ` chosen='${chosen}', (mega=${canMegaEvo}, ultra=${canUltraBurst}, zmove=${canZMove})`);
                }
            });
            this.choose(choices.join(`, `));
        } else {
            // team preview?
            this.choose(this.chooseTeamPreview(request.side.pokemon));
        }
    }

    chooseTeamPreview(team) {
        return `default`;
    }

    query(text, callback) {
        'use strict';
        process.stdin.resume();
        process.stdout.write(text);
        process.stdin.once("data", function (data) {
            callback(data.toString().trim());
        });
    }


    chooseMove(moves) {
        let now = new Date().getTime();

        this.result = undefined;

        while ((new Date().getTime() - now < 10_000) && this.result === undefined) {

        }

        let res = this.result === undefined ? this.prng.sample(moves).choice : this.result;
        console.log(res);
        return res;
    }

    chooseSwitch(switches) {
        return this.prng.sample(switches).slot;
    }
}

const team = [{
    name: "",
    species: "raichu",
    item: "airbaloon",
    ability: "wonderguard",
    moves: ["thunderbolt", "roost", "vcreate", "kingsshield"],
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
    name: "Player",
    team: Dex.packTeam(team),
};
const p2spec = {
    name: "Bot 2",
    team: Dex.packTeam(Dex.generateTeam('gen7randombattle')),
};

const p1 = new TextPlayer(streams.p1);
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
            console.log(line);
    }
})();

streams.omniscient.write(`>start ${JSON.stringify(spec)}
>player p1 ${JSON.stringify(p1spec)}
>player p2 ${JSON.stringify(p2spec)}`);