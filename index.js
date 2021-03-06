const {Client, RichEmbed} = require('discord.js');
const client = new Client();
const fs = require('fs');
const {BattleStream, getPlayerStreams} = require("./pokemonshowdown/pokemon-showdown/.sim-dist/battle-stream");
const {RandomPlayerAI} = require("./pokemonshowdown/pokemon-showdown/.sim-dist/tools/random-player-ai");
const {BattleMovedex} = require("./pokemonshowdown/pokemon-showdown/data/moves");
const {BattleLearnsets} = require("./pokemonshowdown/pokemon-showdown/data/learnsets");
const {BattlePokedex} = require("./pokemonshowdown/pokemon-showdown/data/pokedex");
const {Dex} = require('./pokemonshowdown/pokemon-showdown/.sim-dist/dex');
const _battlestream = require('./pokemonshowdown/pokemon-showdown/.sim-dist/battle-stream');
const _prng = require('./pokemonshowdown/pokemon-showdown/.sim-dist/prng');

const contents = fs.readFileSync('token.json', 'utf8');
const token = JSON.parse(contents).live;

let database = JSON.parse(fs.readFileSync('db.json', 'utf8'));

function saveDB() {
    fs.writeFileSync("db.json", JSON.stringify(database));
}

function getRandomKey(collection) {
    let keys = Object.keys(collection);
    let index = Math.floor(Math.random() * keys.length);
    return keys[index];
}

function generateNewIVS() {
    // Square root distribution
    let dat = [];

    for (let i = 0; i < 6; i++) {
        dat.push(Math.floor(Math.random() ** 2 * 31));
    }

    return dat;
}

function generateNewLevel() {
    // Square root distribution
    return Math.floor(Math.cbrt(Math.random() ** 2 * 100)) + 1;
}

function sum(ivs) {
    let i = 0;

    for (let j of ivs) {
        i += j;
    }

    return i;
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

        let res = this.result === undefined ? this.prng.sample(moves).choice : moves[this.result].choice;
        console.log(res);
        return res;
    }

    chooseSwitch(switches) {
        return this.prng.sample(switches).slot;
    }
}

IN_MEM_DB = { // channel_id => text_player

};

function convert(color) {
    var colours = {
        "aliceblue": "#f0f8ff",
        "antiquewhite": "#faebd7",
        "aqua": "#00ffff",
        "aquamarine": "#7fffd4",
        "azure": "#f0ffff",
        "beige": "#f5f5dc",
        "bisque": "#ffe4c4",
        "black": "#000000",
        "blanchedalmond": "#ffebcd",
        "blue": "#0000ff",
        "blueviolet": "#8a2be2",
        "brown": "#a52a2a",
        "burlywood": "#deb887",
        "cadetblue": "#5f9ea0",
        "chartreuse": "#7fff00",
        "chocolate": "#d2691e",
        "coral": "#ff7f50",
        "cornflowerblue": "#6495ed",
        "cornsilk": "#fff8dc",
        "crimson": "#dc143c",
        "cyan": "#00ffff",
        "darkblue": "#00008b",
        "darkcyan": "#008b8b",
        "darkgoldenrod": "#b8860b",
        "darkgray": "#a9a9a9",
        "darkgreen": "#006400",
        "darkkhaki": "#bdb76b",
        "darkmagenta": "#8b008b",
        "darkolivegreen": "#556b2f",
        "darkorange": "#ff8c00",
        "darkorchid": "#9932cc",
        "darkred": "#8b0000",
        "darksalmon": "#e9967a",
        "darkseagreen": "#8fbc8f",
        "darkslateblue": "#483d8b",
        "darkslategray": "#2f4f4f",
        "darkturquoise": "#00ced1",
        "darkviolet": "#9400d3",
        "deeppink": "#ff1493",
        "deepskyblue": "#00bfff",
        "dimgray": "#696969",
        "dodgerblue": "#1e90ff",
        "firebrick": "#b22222",
        "floralwhite": "#fffaf0",
        "forestgreen": "#228b22",
        "fuchsia": "#ff00ff",
        "gainsboro": "#dcdcdc",
        "ghostwhite": "#f8f8ff",
        "gold": "#ffd700",
        "goldenrod": "#daa520",
        "gray": "#808080",
        "green": "#008000",
        "greenyellow": "#adff2f",
        "honeydew": "#f0fff0",
        "hotpink": "#ff69b4",
        "indianred ": "#cd5c5c",
        "indigo": "#4b0082",
        "ivory": "#fffff0",
        "khaki": "#f0e68c",
        "lavender": "#e6e6fa",
        "lavenderblush": "#fff0f5",
        "lawngreen": "#7cfc00",
        "lemonchiffon": "#fffacd",
        "lightblue": "#add8e6",
        "lightcoral": "#f08080",
        "lightcyan": "#e0ffff",
        "lightgoldenrodyellow": "#fafad2",
        "lightgrey": "#d3d3d3",
        "lightgreen": "#90ee90",
        "lightpink": "#ffb6c1",
        "lightsalmon": "#ffa07a",
        "lightseagreen": "#20b2aa",
        "lightskyblue": "#87cefa",
        "lightslategray": "#778899",
        "lightsteelblue": "#b0c4de",
        "lightyellow": "#ffffe0",
        "lime": "#00ff00",
        "limegreen": "#32cd32",
        "linen": "#faf0e6",
        "magenta": "#ff00ff",
        "maroon": "#800000",
        "mediumaquamarine": "#66cdaa",
        "mediumblue": "#0000cd",
        "mediumorchid": "#ba55d3",
        "mediumpurple": "#9370d8",
        "mediumseagreen": "#3cb371",
        "mediumslateblue": "#7b68ee",
        "mediumspringgreen": "#00fa9a",
        "mediumturquoise": "#48d1cc",
        "mediumvioletred": "#c71585",
        "midnightblue": "#191970",
        "mintcream": "#f5fffa",
        "mistyrose": "#ffe4e1",
        "moccasin": "#ffe4b5",
        "navajowhite": "#ffdead",
        "navy": "#000080",
        "oldlace": "#fdf5e6",
        "olive": "#808000",
        "olivedrab": "#6b8e23",
        "orange": "#ffa500",
        "orangered": "#ff4500",
        "orchid": "#da70d6",
        "palegoldenrod": "#eee8aa",
        "palegreen": "#98fb98",
        "paleturquoise": "#afeeee",
        "palevioletred": "#d87093",
        "papayawhip": "#ffefd5",
        "peachpuff": "#ffdab9",
        "peru": "#cd853f",
        "pink": "#ffc0cb",
        "plum": "#dda0dd",
        "powderblue": "#b0e0e6",
        "purple": "#800080",
        "rebeccapurple": "#663399",
        "red": "#ff0000",
        "rosybrown": "#bc8f8f",
        "royalblue": "#4169e1",
        "saddlebrown": "#8b4513",
        "salmon": "#fa8072",
        "sandybrown": "#f4a460",
        "seagreen": "#2e8b57",
        "seashell": "#fff5ee",
        "sienna": "#a0522d",
        "silver": "#c0c0c0",
        "skyblue": "#87ceeb",
        "slateblue": "#6a5acd",
        "slategray": "#708090",
        "snow": "#fffafa",
        "springgreen": "#00ff7f",
        "steelblue": "#4682b4",
        "tan": "#d2b48c",
        "teal": "#008080",
        "thistle": "#d8bfd8",
        "tomato": "#ff6347",
        "turquoise": "#40e0d0",
        "violet": "#ee82ee",
        "wheat": "#f5deb3",
        "white": "#ffffff",
        "whitesmoke": "#f5f5f5",
        "yellow": "#ffff00",
        "yellowgreen": "#9acd32"
    };

    if (typeof colours[color.toLowerCase()] != 'undefined')
        return colours[color.toLowerCase()];
    return false;
}

function calculateHP(pokemon) {
    let base = BattlePokedex[pokemon.speciesID].baseStats.hp;
    let iv = pokemon.ivs[0];
    // No EVs/nature yet
    let level = pokemon.level;

    return Math.floor((2 * base + iv) * level / 100) + level + 10;
}

function calculateAtk(pokemon) {
    let base = BattlePokedex[pokemon.speciesID].baseStats.atk;
    let iv = pokemon.ivs[1];
    // No EVs/nature yet
    let level = pokemon.level;

    return Math.floor((2 * base + iv) * level / 100) + 5;
}

function calculateDef(pokemon) {
    let base = BattlePokedex[pokemon.speciesID].baseStats.def;
    let iv = pokemon.ivs[2];
    // No EVs/nature yet
    let level = pokemon.level;

    return Math.floor((2 * base + iv) * level / 100) + 5;
}

function calculateSpA(pokemon) {
    let base = BattlePokedex[pokemon.speciesID].baseStats.spa;
    let iv = pokemon.ivs[3];
    // No EVs/nature yet
    let level = pokemon.level;

    return Math.floor((2 * base + iv) * level / 100) + 5;
}

function calculateSpD(pokemon) {
    let base = BattlePokedex[pokemon.speciesID].baseStats.spd;
    let iv = pokemon.ivs[4];
    // No EVs/nature yet
    let level = pokemon.level;

    return Math.floor((2 * base + iv) * level / 100) + 5;
}

function calculateSpe(pokemon) {
    let base = BattlePokedex[pokemon.speciesID].baseStats.spe;
    let iv = pokemon.ivs[5];
    // No EVs/nature yet
    let level = pokemon.level;

    return Math.floor((2 * base + iv) * level / 100) + 5;
}

String.prototype.toTitleCase = function () {
    var i, j, str, lowers, uppers;
    str = this.replace(/([^\W_]+[^\s-]*) */g, function (txt) {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });

    // Certain minor words should be left lowercase unless
    // they are the first or last words in the string
    lowers = ['A', 'An', 'The', 'And', 'But', 'Or', 'For', 'Nor', 'As', 'At',
        'By', 'For', 'From', 'In', 'Into', 'Near', 'Of', 'On', 'Onto', 'To', 'With'];
    for (i = 0, j = lowers.length; i < j; i++)
        str = str.replace(new RegExp('\\s' + lowers[i] + '\\s', 'g'),
            function (txt) {
                return txt.toLowerCase();
            });

    // Certain words such as initialisms or acronyms should be left uppercase
    uppers = ['Id', 'Tv'];
    for (i = 0, j = uppers.length; i < j; i++)
        str = str.replace(new RegExp('\\b' + uppers[i] + '\\b', 'g'),
            uppers[i].toUpperCase());

    return str;
}


client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});


client.on('message', message => {
    if (message.author.bot) return;
    try {
        if (message.content.startsWith("a!")) {
            // Parse command (split by space to get parts)
            let rest = message.content.substr(2).match(/(?:[^\s"]+|"[^"]*")+/g);
            rest = rest.map((x) => x.replace('"', ''));

            // Move usage
            if (rest[0] === 'use') {
                let choice = +rest[1] - 1;
                IN_MEM_DB[message.channel.id].result = choice;
            }
            // Catch command
            else if (rest[0] === "catch") {
                // Look up pokemon in this channel
                if (database.wild.hasOwnProperty(message.guild.id) && !database.wild[message.guild.id].latestPokemon.caught) {
                    let pokemon = database.wild[message.guild.id].latestPokemon.pokemon;
                    let pokemonGuess = rest.slice(1).join(' ');

                    // Check guess
                    if (pokemonGuess.toLowerCase() === pokemon.species.toLowerCase()) {
                        // Correct => say correct
                        database.wild[message.guild.id].latestPokemon.caught = true;
                        message.channel.send(`Correct! You caught a level ${pokemon.level} ${pokemon.species}`);

                        // Set up user data if it doesn't yet exist
                        if (!database.user.hasOwnProperty(message.author.id)) {
                            database.user[message.author.id] = {};
                        }

                        // Set up pokemon array if it doesn't exist yet
                        if (!database.user[message.author.id].hasOwnProperty("pokemon")) {
                            database.user[message.author.id].pokemon = [];
                        }

                        // Add to array
                        database.user[message.author.id].pokemon.push(pokemon);
                    } else {
                        message.channel.send("Incorrect!");
                    }

                    saveDB();
                } else {
                    message.channel.send("There are no Pokemon available in this guild!");
                }
            } else if (rest[0] === "pokemon") {
                let page = 1;
                if (rest.length > 1) {
                    page = +(rest[1]);
                }

                page--;

                let data = "";
                const pokemonList = database.user[message.author.id].pokemon;
                if (20 * page > pokemonList.length) {
                    return message.channel.send(`You only have ${pokemonList.length} pokemon!`);
                }

                for (let i = 20 * page; i < 20 + 20 * page; i++) {
                    if (i < pokemonList.length) {
                        const pokemon = pokemonList[i];
                        data += `${pokemon.species} | Level ${pokemon.level} | Number: ${i + 1} | IVs: ${Math.round(sum(pokemon.ivs) / (31 * 6) * 100)}%\n`;
                    }
                }

                message.channel.send("```" + data + "```");
            } else if (rest[0] === "view") {
                let number = +(rest[1]);
                number--;
                if (rest.length === 1) {
                    number = database.user[message.author.id].selected;
                }
                if (number === undefined) number = 1;

                const pokemonList = database.user[message.author.id].pokemon;
                if (number >= pokemonList.length) {
                    return message.channel.send(`You only have ${pokemonList.length} pokemon!`);
                }

                let pokemon = pokemonList[number];

                // Set up embed
                const embed = new RichEmbed()
                    // Set the title of the field
                        .setTitle(`Level ${pokemon.level} ${pokemon.species}`)
                        // Set the color of the embed
                        .setColor(parseInt(convert(BattlePokedex[pokemon.speciesID].color.toLowerCase()).substr(1), 16))
                        // Add fields
                        .addField('XP', `${pokemon.xp}/2000`, true)
                        .addField('HP', `${calculateHP(pokemon)} | IV: ${pokemon.ivs[0]}/31`, true)
                        .addField('Attack', `${calculateAtk(pokemon)} | IV: ${pokemon.ivs[1]}/31`, true)
                        .addField('Defense', `${calculateDef(pokemon)} | IV: ${pokemon.ivs[2]}/31`, true)
                        .addField('Special Attack', `${calculateSpA(pokemon)} | IV: ${pokemon.ivs[3]}/31`, true)
                        .addField('Special Defense', `${calculateSpD(pokemon)} | IV: ${pokemon.ivs[4]}/31`, true)
                        .addField('Speed', `${calculateSpe(pokemon)} | IV: ${pokemon.ivs[5]}/31`, true)
                        .addField('Total IVs', `${Math.round(sum(pokemon.ivs) / (31 * 6) * 100)}%`)
                        // Image
                        .setImage(`http://play.pokemonshowdown.com/sprites/ani/${pokemon.speciesID}.gif`)
                ;

                let msg = message.channel.send(embed);
            } else if (rest[0] === "moves") {
                let pokemon = database.user[message.author.id].pokemon[database.user[message.author.id].selected];
                if (rest.length === 1) {
                    // Generate available moves
                    let available = "Available: ";
                    let moves = Object.keys(BattleLearnsets[pokemon.speciesID].learnset);

                    for (let i of moves) {
                        available += "\n" + BattleMovedex[i].name;
                    }

                    // Output current and available moves
                    const embed = new RichEmbed()
                    // Set the title of the field
                        .setTitle(`Level ${pokemon.level} ${pokemon.species}`)
                        // Set the color of the embed
                        .setColor(parseInt(convert(BattlePokedex[pokemon.speciesID].color.toLowerCase()).substr(1), 16))
                        // Add fields
                        .addField("Move 1", pokemon.moves[0].name, true)
                        .addField("Move 2", pokemon.moves[1].name, true)
                        .addField("Move 3", pokemon.moves[2].name, true)
                        .addField("Move 4", pokemon.moves[3].name, true)
                        .setDescription(available)
                        // Image
                        .setImage(`http://play.pokemonshowdown.com/sprites/ani/${pokemon.speciesID}.gif`);
                    message.channel.send(embed);
                    return;
                } else if (rest.length === 5) {
                    const newMoves = [rest[1].replace('"', ''), rest[2].replace('"', ''), rest[3].replace('"', ''), rest[4].replace('"', '')];
                    // Verify new moves
                    let validMoves = Object.keys(BattleLearnsets[pokemon.speciesID].learnset).map((x) => x.toLowerCase());
                    let valid = true;

                    for (let move of newMoves) {
                        if (validMoves.indexOf(move.toLowerCase()) === -1) {
                            valid = false;
                            console.log(move);
                            break;
                        }
                    }

                    if (valid) {
                        database.user[message.author.id].pokemon[database.user[message.author.id].selected].moves = [
                            {'name': BattleMovedex[newMoves[0]].name, 'id': newMoves[0]},
                            {'name': BattleMovedex[newMoves[1]].name, 'id': newMoves[1]},
                            {'name': BattleMovedex[newMoves[2]].name, 'id': newMoves[2]},
                            {'name': BattleMovedex[newMoves[3]].name, 'id': newMoves[3]}
                        ];

                        message.channel.send("Set moves!");
                    } else {
                        message.channel.send("Invalid!");
                    }
                }

                saveDB();
            } else if (rest[0] === "select") {
                let index = 0;
                if (rest.length > 1) {
                    index = +rest[1];
                }

                index--;

                const pokemonList = database.user[message.author.id].pokemon;
                if (index >= pokemonList.length) {
                    return message.channel.send(`You only have ${pokemonList.length} pokemon!`);
                }

                database.user[message.author.id].selected = index;
                const pokemon = pokemonList[index];
                message.channel.send(`Selected your Level ${pokemon.level} ${pokemon.species}!`);
                saveDB();
            } else if (rest[0] === "battle") {
                // a!battle <ping> p1 p2 p3 p4 p5 p6
                if (rest.length !== 8) {
                    message.channel.send("Not enough args! Example: `a!battle @UserName 1 2 3 4 5 6`");
                    return;
                }

                if (IN_MEM_DB[message.channel.id] !== undefined) {
                    message.channel.send("There is already a battle in this channel!");
                    return;
                }

                let pokemonList = database.user[message.author.id].pokemon;
                let team = [];

                for (let i = 0; i < 6; i++) {
                    let pokemon = pokemonList[+(rest[i + 2]) - 1];
                    if (pokemon === undefined) {
                        message.channel.send(`Invalid pokemon ${rest[i + 2]}!`);
                        return;
                    }
                    team.push({
                        name: "",
                        species: pokemon.speciesID,
                        item: "",
                        ability: pokemon.ability,
                        moves: pokemon.moves.map((x) => x.id),
                        nature: "docile",
                        gender: "m",
                        evs: [0, 0, 0, 0, 0, 0],
                        ivs: pokemon.ivs,
                        level: pokemon.level,
                    });
                }


                const spec = {
                    formatid: "gen8customgame",
                };

                const p1spec = {
                    name: message.author.name,
                    team: Dex.packTeam(team),
                };
                const p2spec = {
                    name: message.author.name,
                    team: Dex.packTeam(Dex.generateTeam('gen8randombattle')),
                };

                const streams = getPlayerStreams(new BattleStream());
                const p1 = new TextPlayer(streams.p1);
                IN_MEM_DB[message.channel.id] = p1;
                const p2 = new RandomPlayerAI(streams.p2);

                (async () => {
                    p1.start();
                    p2.start();
                    streams.omniscient.write(`>start ${JSON.stringify(spec)}
>player p1 ${JSON.stringify(p1spec)}
>player p2 ${JSON.stringify(p2spec)}`);

                    let chunk;
                    // tslint:disable-next-line no-conditional-assignment
                    while ((chunk = await streams.omniscient.read())) {
                        // console.log(BattleLog.parseLine(chunk));
                        message.channel.send(chunk);
                    }

                    // Battle over
                    IN_MEM_DB[message.channel.id] = undefined;
                })();
            }
        } else {
            if (database.user.hasOwnProperty(message.author.id) && database.user[message.author.id].hasOwnProperty("selected") && database.user[message.author.id].pokemon.length > database.user[message.author.id].selected) {
                let u = database.user[message.author.id];
                if (!u.hasOwnProperty("lastXPTime")) database.user[message.author.id].lastXPTime = 0;
                if ((new Date().getTime()) - u.lastXPTime > 1000 * 60) {
                    // Add XP
                    let sel = database.user[message.author.id].selected;
                    database.user[message.author.id].pokemon[sel].xp += 200;
                    while (database.user[message.author.id].pokemon[sel].xp > 2000) {
                        database.user[message.author.id].pokemon[sel].xp -= 2000;
                        database.user[message.author.id].pokemon[sel].level++;

                        if (database.user[message.author.id].pokemon[sel].level > 100) database.user[message.author.id].pokemon[sel].level = 100;
                        // TODO: evolution

                        let pokemon = database.user[message.author.id].pokemon[sel];
                        message.reply(`Your ${pokemon.species} has leveled up to Level ${pokemon.level}!`);
                    }

                    database.user[message.author.id].lastXPTime = new Date().getTime();
                    saveDB();
                }
            }
            if (Math.random() < 1) { // 1% chance per message to spawn Pokemon TODO go back
                if (!database.wild.hasOwnProperty(message.guild.id))
                    database[message.guild.id] = {};

                // Generate species
                let speciesID = getRandomKey(BattlePokedex); // TODO: disable formes
                let species = BattlePokedex[speciesID];

                // Spawn Pokemon
                let spawned_pokemon = {
                    // Generate IVs, type, ability, etc.
                    species: species.species,
                    ivs: generateNewIVS(),
                    ability: species.abilities[getRandomKey(species.abilities)],
                    level: generateNewLevel(),
                    speciesID: speciesID,
                    xp: 0,
                    moves: [{id: 'tackle', name: 'Tackle'}, {id: 'tackle', name: 'Tackle'}, {
                        id: 'tackle',
                        name: 'Tackle'
                    }, {id: 'tackle', name: 'Tackle'}]
                    // TODO: nature/evs?
                };

                // Set up embed
                const embed = new RichEmbed()
                    // Set the title of the field
                        .setTitle('A wild Pokemon has appeared!')
                        // Set the color of the embed
                        .setColor(0x3297a8)
                        // Set the main content of the embed
                        .setDescription('Guess its name to catch it!')
                        // Image
                        .setImage(`http://play.pokemonshowdown.com/sprites/ani/${spawned_pokemon.speciesID}.gif`)
                ;
                // Send the embed to the same channel as the message
                let msg = message.channel.send(embed);

                database.wild[message.guild.id].latestPokemon = {
                    caught: false,
                    id: msg.id,
                    pokemon: spawned_pokemon
                };
                saveDB();
            }
        }
    } catch (error) {
        // Handle error
        console.log(error);
        message.channel.send(error.toString());
    }
});

client.login(token);