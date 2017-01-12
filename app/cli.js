"use strict";

const co = require('co');
const logger = require('../app/lib/logger')('cli');
const async = require('async');
const Q = require('q');
const _ = require('underscore');
const Command = require('commander').Command;
const contacter = require('../app/lib/contacter');
const directory = require('../app/lib/system/directory');
const wizard = require('../app/lib/wizard');
const multicaster = require('../app/lib/streams/multicaster');
const keyring = require('../app/lib/crypto/keyring');
const base58 = require('../app/lib/crypto/base58');
const pjson = require('../package.json');
const duniter = require('../index');
const Peer = require('../app/lib/entity/peer');
const Block = require('../app/lib/entity/block');
const constants = require('../app/lib/constants');

module.exports = () => {

  const ERASE_IF_ALREADY_RECORDED = true;
  const NO_LOGS = true;

  const options = [];
  const commands = [];

  return {

    addOption: (optFormat, optDesc, optParser) => options.push({ optFormat, optDesc, optParser }),

    addCommand: (command, executionCallback) => commands.push({ command, executionCallback }),

    // To execute the provided command
    execute: (programArgs, onServiceCallback) => co(function*() {

      const program = new Command();

      let onResolve, onReject = () => Promise.reject(Error("Uninitilized rejection throw")), onService, closeCommand = () => Promise.resolve(true);
      const currentCommand = new Promise((resolve, reject) => {
        onResolve = resolve;
        onReject = reject;
      });

      program
        .version(pjson.version)
        .usage('<command> [options]')

        .option('--home <path>', 'Path to Duniter HOME (defaults to "$HOME/.config/duniter").')
        .option('-d, --mdb <name>', 'Database name (defaults to "duniter_default").')

        .option('--autoconf', 'With `config` and `init` commands, will guess the best network and key options witout asking for confirmation')
        .option('--ipv4 <address>', 'IPv4 interface to listen for requests')
        .option('--ipv6 <address>', 'IPv6 interface to listen for requests')
        .option('--remoteh <host>', 'Remote interface others may use to contact this node')
        .option('--remote4 <host>', 'Remote interface for IPv4 access')
        .option('--remote6 <host>', 'Remote interface for IPv6 access')
        .option('-p, --port <port>', 'Port to listen for requests', parseInt)
        .option('--remotep <port>', 'Remote port others may use to contact this node')
        .option('--upnp', 'Use UPnP to open remote port')
        .option('--noupnp', 'Do not use UPnP to open remote port')
        .option('--addep <endpoint>', 'With `config` command, add given endpoint to the list of endpoints of this node')
        .option('--remep <endpoint>', 'With `config` command, remove given endpoint to the list of endpoints of this node')

        .option('--salt <salt>', 'Key salt to generate this key\'s secret key')
        .option('--passwd <password>', 'Password to generate this key\'s secret key')
        .option('--participate <Y|N>', 'Participate to writing the blockchain')
        .option('--cpu <percent>', 'Percent of CPU usage for proof-of-work computation', parsePercent)

        .option('-c, --currency <name>', 'Name of the currency managed by this node.')
        .option('--sigPeriod <timestamp>', 'Minimum delay between 2 certifications of a same issuer, in seconds.')
        .option('--sigStock <count>', 'Maximum quantity of valid certifications per member.')
        .option('--sigWindow <duration>', 'Maximum age of a non-written certification.')
        .option('--idtyWindow <duration>', 'Maximum age of a non-written certification.')
        .option('--sigValidity <timestamp>', 'Validity duration of a certification, in seconds.')
        .option('--msValidity <timestamp>', 'Validity duration of a memberships, in seconds.')
        .option('--sigQty <number>', 'Minimum number of required certifications to be a member/stay as a member')
        .option('--medtblocks <number>', 'medianTimeBlocks parameter of UCP')
        .option('--avgGenTime <number>', 'avgGenTime parameter of UCP')
        .option('--dtdiffeval <number>', 'dtDiffEval parameter of UCP')
        .option('--powZeroMin <number>', 'Minimum number of leading zeros for a proof-of-work')
        .option('--powPeriod <number>', 'Number of blocks to wait to decrease proof-of-work difficulty by one')
        .option('--powDelay <number>', 'Number of seconds to wait before starting the computation of next block')
        .option('--growth <number>', 'Universal Dividend %growth. Aka. \'c\' parameter in RTM', parsePercent)
        .option('--ud0 <number>', 'Universal Dividend initial value')
        .option('--dt <number>', 'Number of seconds between two UD')
        .option('--rootoffset <number>', 'Allow to give a time offset for first block (offset in the past)')
        .option('--show', 'With gen-next or gen-root commands, displays the generated block')

        .option('--nointeractive', 'Disable interactive sync UI')
        .option('--nocautious', 'Do not check blocks validity during sync')
        .option('--cautious', 'Check blocks validity during sync (overrides --nocautious option)')
        .option('--nopeers', 'Do not retrieve peers during sync')
        .option('--nostdout', 'Disable stdout printing for `export-bc` command')
        .option('--noshuffle', 'Disable peers shuffling for `sync` command')

        .option('--timeout <milliseconds>', 'Timeout to use when contacting peers', parseInt)
        .option('--httplogs', 'Enable HTTP logs')
        .option('--nohttplogs', 'Disable HTTP logs')
        .option('--isolate', 'Avoid the node to send peering or status informations to the network')
        .option('--check', 'With gen-next: just check validity of generated block')
        .option('--forksize <size>', 'Maximum size of fork window', parseInt)
        .option('--memory', 'Memory mode')
      ;

      for (const opt of options) {
        program
          .option(opt.optFormat, opt.optDesc, opt.optParser);
      }

      for (const cmd of commands) {
        program
          .command(cmd.command.name)
          .description(cmd.command.desc)
          .action((...args) => co(function*() {
            try {
              const res = yield cmd.executionCallback.apply(null, [program].concat(args));
              onResolve(res);
            } catch (e) {
              onReject(e);
            }
          }));
      }

      program
        .command('start')
        .description('Start Duniter node daemon.')
        .action(subCommand(service((server, conf) => new Promise((resolve, reject) => {
          co(function*() {
            try {
              const bma = require('./lib/streams/bma');

              logger.info(">> NODE STARTING");

              // Public http interface
              let bmapi = yield bma(server, null, conf.httplogs);

              // Routing documents
              server.routing();

              // Services
              yield server.startServices();
              yield bmapi.openConnections();

              logger.info('>> Server ready!');

            } catch (e) {
              reject(e);
            }
          });
        }))));

      program
        .command('stop')
        .description('Stop Duniter node daemon.')
        .action(subCommand(needsToBeLaunchedByScript));

      program
        .command('restart')
        .description('Restart Duniter node daemon.')
        .action(subCommand(needsToBeLaunchedByScript));

      program
        .command('wizard [step]')
        .description('Launch the configuration wizard.')
        .action(subCommand(function (step) {
          // Only show message "Saved"
          return connect(function (step, server, conf) {
            return new Promise((resolve, reject) => {
              async.series([
                function (next) {
                  startWizard(service, step, server, conf, next);
                }
              ], (err) => {
                if (err) return reject(err);
                resolve();
              });
            });
          })(step, null);
        }));

      program
        .command('sync [host] [port] [to]')
        .description('Synchronize blockchain from a remote Duniter node')
        .action(subCommand(service(function (host, port, to, server, conf) {
          if (!host) {
            throw 'Host is required.';
          }
          if (!port) {
            throw 'Port is required.';
          }
          return co(function *() {
            let cautious;
            if (program.nocautious) {
              cautious = false;
            }
            if (program.cautious) {
              cautious = true;
            }
            yield server.synchronize(host, port, parseInt(to), 0, !program.nointeractive, cautious, program.nopeers, program.noshuffle);
            if (server) {
              yield server.disconnect();
            }
          });
        })));

      program
        .command('peer [host] [port]')
        .description('Exchange peerings with another node')
        .action(subCommand(service(function (host, port, server) {
          return co(function *() {
            try {
              logger.info('Fetching peering record at %s:%s...', host, port);
              let peering = yield contacter.statics.fetchPeer(host, port);
              logger.info('Apply peering ...');
              yield server.PeeringService.submitP(peering, ERASE_IF_ALREADY_RECORDED, !program.nocautious);
              logger.info('Applied');
              let selfPeer = yield server.dal.getPeer(server.PeeringService.pubkey);
              if (!selfPeer) {
                yield Q.nfcall(server.PeeringService.generateSelfPeer, server.conf, 0);
                selfPeer = yield server.dal.getPeer(server.PeeringService.pubkey);
              }
              logger.info('Send self peering ...');
              var caster = multicaster();
              yield caster.sendPeering(Peer.statics.peerize(peering), Peer.statics.peerize(selfPeer));
              logger.info('Sent.');
              yield server.disconnect();
            } catch(e) {
              logger.error(e.code || e.message || e);
              throw Error("Exiting");
            }
          });
        })));

      program
        .command('revert [count]')
        .description('Revert (undo + remove) the top [count] blocks from the blockchain. EXPERIMENTAL')
        .action(subCommand(service(function (count, server) {
          return co(function *() {
            try {
              for (let i = 0; i < count; i++) {
                yield server.revert();
              }
            } catch (err) {
              logger.error('Error during revert:', err);
            }
            // Save DB
            yield server.disconnect();
          });
        })));

      program
        .command('revert-to [number]')
        .description('Revert (undo + remove) top blockchain blocks until block #[number] is reached. EXPERIMENTAL')
        .action(subCommand(service(function (number, server) {
          return co(function *() {
            try {
              yield server.revertTo(number);
            } catch (err) {
              logger.error('Error during revert:', err);
            }
            // Save DB
            if (server) {
              yield server.disconnect();
            }
          });
        })));

      program
        .command('reapply-to [number]')
        .description('Reapply reverted blocks until block #[number] is reached. EXPERIMENTAL')
        .action(subCommand(service(function (number, server) {
          return co(function *() {
            try {
              yield server.reapplyTo(number);
            } catch (err) {
              logger.error('Error during reapply:', err);
            }
            // Save DB
            if (server) {
              yield server.disconnect();
            }
          });
        })));

      program
        .command('gen-next [host] [port] [difficulty]')
        .description('Tries to generate the next block of the blockchain')
        .action(subCommand(service(generateAndSend(program, (server) => server.BlockchainService.generateNext))));

      program
        .command('gen-root [host] [port] [difficulty]')
        .description('Tries to generate root block, with choice of root members')
        .action(subCommand(service(function (host, port, difficulty, server, conf) {
          if (!host) {
            throw 'Host is required.';
          }
          if (!port) {
            throw 'Port is required.';
          }
          if (!difficulty) {
            throw 'Difficulty is required.';
          }
          return generateAndSend(program, (server) => server.BlockchainService.generateManualRoot)(host, port, difficulty, server, conf);
        })));

      program
        .command('export-bc [upto]')
        .description('Exports the whole blockchain as JSON array, up to [upto] block number (excluded).')
        .action(subCommand(service(function (upto, server) {
          return co(function *() {
            try {
              let CHUNK_SIZE = 500;
              let jsoned = [];
              let current = yield server.dal.getCurrentBlockOrNull();
              let lastNumber = current ? current.number + 1 : -1;
              if (upto !== undefined && upto.match(/\d+/)) {
                lastNumber = Math.min(parseInt(upto), lastNumber);
              }
              let chunksCount = Math.floor(lastNumber / CHUNK_SIZE);
              let chunks = [];
              // Max-size chunks
              for (let i = 0, len = chunksCount; i < len; i++) {
                chunks.push({start: i * CHUNK_SIZE, to: i * CHUNK_SIZE + CHUNK_SIZE - 1});
              }
              // A last chunk
              if (lastNumber > chunksCount * CHUNK_SIZE) {
                chunks.push({start: chunksCount * CHUNK_SIZE, to: lastNumber});
              }
              for (const chunk of chunks) {
                let blocks = yield server.dal.getBlocksBetween(chunk.start, chunk.to);
                blocks.forEach(function (block) {
                  jsoned.push(_(new Block(block).json()).omit('raw'));
                });
              }
              if (!program.nostdout) {
                console.log(JSON.stringify(jsoned, null, "  "));
              }
              yield server.disconnect();
              return jsoned;
            } catch(err) {
              logger.warn(err.message || err);
              yield server.disconnect();
            }
          });
        }, NO_LOGS)));

      program
        .command('check-config')
        .description('Checks the node\'s configuration')
        .action(subCommand(service(function (server) {
          return server.checkConfig()
            .then(function () {
              logger.warn('Configuration seems correct.');
            })
        })));

      program
        .command('reset [config|data|peers|tx|stats|all]')
        .description('Reset configuration, data, peers, transactions or everything in the database')
        .action(subCommand((type) => {
          let init = ['data', 'all'].indexOf(type) !== -1 ? server.bind(server, program) : connect;
          return init(function (server) {
            if (!~['config', 'data', 'peers', 'stats', 'all'].indexOf(type)) {
              throw constants.ERRORS.CLI_CALLERR_RESET;
            }
            return co(function*() {
              try {
                if (type == 'data') {
                  yield server.resetData();
                  logger.warn('Data successfully reseted.');
                }
                if (type == 'peers') {
                  yield server.resetPeers();
                  logger.warn('Peers successfully reseted.');
                }
                if (type == 'stats') {
                  yield server.resetStats();
                  logger.warn('Stats successfully reseted.');
                }
                if (type == 'config') {
                  yield server.resetConf();
                  logger.warn('Configuration successfully reseted.');
                }
                if (type == 'all') {
                  yield server.resetAll();
                  logger.warn('Data & Configuration successfully reseted.');
                }
              } catch (e) {
                logger.error(e);
              }
            });
          }, type != 'peers')(type);
        }));

      program
        .on('*', function (cmd) {
          console.log("Unknown command '%s'. Try --help for a listing of commands & options.", cmd);
          onResolve();
        });

      function subCommand(promiseFunc) {
        return function() {
          let args = Array.prototype.slice.call(arguments, 0);
          return co(function*() {
            try {
              let result = yield promiseFunc.apply(null, args);
              onResolve(result);
            } catch (e) {
              if (e && e.uerr) {
                onReject(e.uerr.message);
              } else {
                onReject(e);
              }
            }
          })
        };
      }

      function connect(callback, useDefaultConf) {
        return function () {
          var cbArgs = arguments;
          var dbName = program.mdb || "duniter_default";
          var dbHome = program.home;

          const home = directory.getHome(dbName, dbHome);
          var server = duniter(home, program.memory === true, commandLineConf(program));

          // If ever the process gets interrupted
          let isSaving = false;
          closeCommand = () => co(function*() {
            if (!isSaving) {
              isSaving = true;
              // Save DB
              return server.disconnect();
            }
          });

          // Initialize server (db connection, ...)
          return server.plugFileSystem(useDefaultConf)
            .then(() => server.loadConf())
            .then(function () {
              try {
                cbArgs.length--;
                cbArgs[cbArgs.length++] = server;
                cbArgs[cbArgs.length++] = server.conf;
                return callback.apply(this, cbArgs);
              } catch(e) {
                server.disconnect();
                throw e;
              }
            });
        };
      }

      function service(callback, nologs) {

        return function () {

          if (nologs) {
            // Disable logs
            require('../app/lib/logger')().mute();
          }

          var cbArgs = arguments;
          var dbName = program.mdb;
          var dbHome = program.home;

          // Add log files for this instance
          logger.addHomeLogs(directory.getHome(dbName, dbHome));

          const home = directory.getHome(dbName, dbHome);
          var server = duniter(home, program.memory === true, commandLineConf(program));

          // If ever the process gets interrupted
          let isSaving = false;
          closeCommand = () => co(function*() {
            if (!isSaving) {
              isSaving = true;
              // Save DB
              return server.disconnect();
            }
          });

          const that = this;

          // Initialize server (db connection, ...)
          return co(function*() {
            try {
              yield server.initWithDAL();
              yield configure(program, server, server.conf || {});
              yield server.loadConf();
              cbArgs.length--;
              cbArgs[cbArgs.length++] = server;
              cbArgs[cbArgs.length++] = server.conf;
              cbArgs[cbArgs.length++] = program;
              onService && onService(server);
              return callback.apply(that, cbArgs);
            } catch (e) {
              server.disconnect();
              throw e;
            }
          });
        };
      }

      onService = onServiceCallback;
      program.parse(programArgs);

      if (programArgs.length <= 2) {
        onReject('No command given.');
      }

      const res = yield currentCommand;
      if (closeCommand) {
        yield closeCommand();
      }
      return res;
    })
  };
};

/****************
 *
 *   UTILITIES
 *
 ****************/

function generateAndSend(program, getGenerationMethod) {
  return function (host, port, difficulty, server, conf) {
    return new Promise((resolve, reject) => {
      async.waterfall([
        function (next) {
          const method = getGenerationMethod(server);
          co(function*(){
            try {
              const block = yield method();
              next(null, block);
            } catch(e) {
              next(e);
            }
          });
        },
        function (block, next) {
          if (program.check) {
            block.time = block.medianTime;
            program.show && console.log(block.getRawSigned());
            co(function*(){
              try {
                yield server.doCheckBlock(block);
                logger.info('Acceptable block');
                next();
              } catch (e) {
                next(e);
              }
            });
          }
          else {
            logger.debug('Block to be sent: %s', block.quickDescription());
            var wiz = wizard(server);
            async.waterfall([
              function (next) {
                if (!conf.salt && !conf.passwd)
                  wiz.configKey(conf, next);
                else
                  next();
              },
              function (next) {
                // Extract key pair
                co(function*(){
                  try {
                    const pair = yield keyring.scryptKeyPair(conf.salt, conf.passwd);
                    next(null, pair);
                  } catch(e) {
                    next(e);
                  }
                });
              },
              function (pair, next) {
                proveAndSend(program, server, block, pair.publicKey, parseInt(difficulty), host, parseInt(port), next);
              }
            ], next);
          }
        }
      ], (err, data) => {
        err && reject(err);
        !err && resolve(data);
      });
    });
  };
}

function proveAndSend(program, server, block, issuer, difficulty, host, port, done) {
  var BlockchainService = server.BlockchainService;
  async.waterfall([
    function (next) {
      block.issuer = issuer;
      program.show && console.log(block.getRawSigned());
      co(function*(){
        try {
          const proven = yield BlockchainService.prove(block, difficulty);
          next(null, proven);
        } catch(e) {
          next(e);
        }
      });
    },
    function (block, next) {
      var peer = new Peer({
        endpoints: [['BASIC_MERKLED_API', host, port].join(' ')]
      });
      program.show && console.log(block.getRawSigned());
      logger.info('Posted block ' + block.quickDescription());
      co(function*(){
        try {
          yield multicaster(server.conf).sendBlock(peer, block);
          next();
        } catch(e) {
          next(e);
        }
      });
    }
  ], done);
}

function startWizard(service, step, server, conf, done) {
  var wiz = wizard(server);
  var task = {
    'currency': wiz.configCurrency,
    'basic': wiz.configBasic,
    'pow': wiz.configPoW,
    'network': wiz.configNetwork,
    'network-reconfigure': wiz.configNetworkReconfigure,
    'key': wiz.configKey,
    'ucp': wiz.configUCP
  };
  var wizDo = task[step] || wiz.configAll;
  async.waterfall([
    function (next) {
      wizDo(conf, next);
    },
    function (next) {
      co(function*(){
        try {
          yield server.dal.saveConf(conf);
          logger.debug("Configuration saved.");
          next();
        } catch(e) {
          next(e);
        }
      });
    },
    function (next) {
      // Check config
      service(function (key, server, conf) {
        next();
      })(null, null);
    }
  ], done);
}

function commandLineConf(program, conf) {

  conf = conf || {};
  conf.sync = conf.sync || {};
  var cli = {
    currency: program.currency,
    cpu: program.cpu,
    server: {
      port: program.port,
      ipv4address: program.ipv4,
      ipv6address: program.ipv6,
      salt: program.salt,
      passwd: program.passwd,
      remote: {
        host: program.remoteh,
        ipv4: program.remote4,
        ipv6: program.remote6,
        port: program.remotep
      }
    },
    db: {
      mport: program.mport,
      mdb: program.mdb,
      home: program.home
    },
    net: {
      upnp: program.upnp,
      noupnp: program.noupnp
    },
    logs: {
      http: program.httplogs,
      nohttp: program.nohttplogs
    },
    endpoints: [],
    rmEndpoints: [],
    ucp: {
      rootoffset: program.rootoffset,
      sigPeriod: program.sigPeriod,
      sigStock: program.sigStock,
      sigWindow: program.sigWindow,
      idtyWindow: program.idtyWindow,
      msWindow: program.msWindow,
      sigValidity: program.sigValidity,
      sigQty: program.sigQty,
      msValidity: program.msValidity,
      powZeroMin: program.powZeroMin,
      powPeriod: program.powPeriod,
      powDelay: program.powDelay,
      participate: program.participate,
      ud0: program.ud0,
      c: program.growth,
      dt: program.dt,
      incDateMin: program.incDateMin,
      medtblocks: program.medtblocks,
      dtdiffeval: program.dtdiffeval,
      avgGenTime: program.avgGenTime
    },
    isolate: program.isolate,
    forksize: program.forksize,
    nofork: program.nofork,
    timeout: program.timeout
  };

  // Update conf
  if (cli.currency)                         conf.currency = cli.currency;
  if (cli.server.ipv4address)               conf.ipv4 = cli.server.ipv4address;
  if (cli.server.ipv6address)               conf.ipv6 = cli.server.ipv6address;
  if (cli.server.port)                      conf.port = cli.server.port;
  if (cli.server.salt)                      conf.salt = cli.server.salt;
  if (cli.server.passwd != undefined)       conf.passwd = cli.server.passwd;
  if (cli.server.remote.host != undefined)  conf.remotehost = cli.server.remote.host;
  if (cli.server.remote.ipv4 != undefined)  conf.remoteipv4 = cli.server.remote.ipv4;
  if (cli.server.remote.ipv6 != undefined)  conf.remoteipv6 = cli.server.remote.ipv6;
  if (cli.server.remote.port != undefined)  conf.remoteport = cli.server.remote.port;
  if (cli.ucp.rootoffset)                   conf.rootoffset = cli.ucp.rootoffset;
  if (cli.ucp.sigPeriod)                    conf.sigPeriod = cli.ucp.sigPeriod;
  if (cli.ucp.sigStock)                     conf.sigStock = cli.ucp.sigStock;
  if (cli.ucp.sigWindow)                    conf.sigWindow = cli.ucp.sigWindow;
  if (cli.ucp.idtyWindow)                   conf.idtyWindow = cli.ucp.idtyWindow;
  if (cli.ucp.msWindow)                     conf.msWindow = cli.ucp.msWindow;
  if (cli.ucp.sigValidity)                  conf.sigValidity = cli.ucp.sigValidity;
  if (cli.ucp.msValidity)                   conf.msValidity = cli.ucp.msValidity;
  if (cli.ucp.sigQty)                       conf.sigQty = cli.ucp.sigQty;
  if (cli.ucp.msValidity)                   conf.msValidity = cli.ucp.msValidity;
  if (cli.ucp.powZeroMin)                   conf.powZeroMin = cli.ucp.powZeroMin;
  if (cli.ucp.powPeriod)                    conf.powPeriod = cli.ucp.powPeriod;
  if (cli.ucp.powDelay)                     conf.powDelay = cli.ucp.powDelay;
  if (cli.ucp.participate)                  conf.participate = cli.ucp.participate == 'Y';
  if (cli.ucp.dt)                           conf.dt = cli.ucp.dt;
  if (cli.ucp.c)                            conf.c = cli.ucp.c;
  if (cli.ucp.ud0)                          conf.ud0 = cli.ucp.ud0;
  if (cli.ucp.incDateMin)                   conf.incDateMin = cli.ucp.incDateMin;
  if (cli.ucp.medtblocks)                   conf.medianTimeBlocks = cli.ucp.medtblocks;
  if (cli.ucp.avgGenTime)                   conf.avgGenTime = cli.ucp.avgGenTime;
  if (cli.ucp.dtdiffeval)                   conf.dtDiffEval = cli.ucp.dtdiffeval;
  if (cli.net.upnp)                         conf.upnp = true;
  if (cli.net.noupnp)                       conf.upnp = false;
  if (cli.cpu)                              conf.cpu = Math.max(0.01, Math.min(1.0, cli.cpu));
  if (cli.logs.http)                        conf.httplogs = true;
  if (cli.logs.nohttp)                      conf.httplogs = false;
  if (cli.db.mport)                         conf.mport = cli.db.mport;
  if (cli.db.home)                          conf.home = cli.db.home;
  if (cli.db.mdb)                           conf.mdb = cli.db.mdb;
  if (cli.isolate)                          conf.isolate = cli.isolate;
  if (cli.timeout)                          conf.timeout = cli.timeout;
  if (cli.forksize != null)                 conf.forksize = cli.forksize;

  // Specific internal settings
  conf.createNext = true;
  return _(conf).extend({routing: true});
}

/**
 * Super basic server with only its home path set
 * @param program
 * @param callback
 * @param useDefaultConf
 * @returns {Function}
 */
function server(program, callback, useDefaultConf) {
  return function () {
    var cbArgs = arguments;
    var dbName = program.mdb || "duniter_default";
    var dbHome = program.home;

    const home = directory.getHome(dbName, dbHome);
    var server = duniter(home, program.memory === true, commandLineConf(program));

    cbArgs.length--;
    cbArgs[cbArgs.length++] = server;
    cbArgs[cbArgs.length++] = server.conf;
    return callback.apply(this, cbArgs);
  };
}

function parsePercent(s) {
  var f = parseFloat(s);
  return isNaN(f) ? 0 : f;
}

function needsToBeLaunchedByScript() {
    logger.error('This command must not be launched directly, using duniter.sh script');
    return Promise.resolve();
}

function configure(program, server, conf) {
  return co(function *() {
    if (typeof server == "string" || typeof conf == "string") {
      throw constants.ERRORS.CLI_CALLERR_CONFIG;
    }
    let wiz = wizard();
    // UPnP override
    if (program.noupnp === true) {
      conf.upnp = false;
    }
    if (program.upnp === true) {
      conf.upnp = true;
    }
    // Network autoconf
    const autoconfNet = program.autoconf
      || !(conf.ipv4 || conf.ipv6)
      || !(conf.remoteipv4 || conf.remoteipv6 || conf.remotehost)
      || !(conf.port && conf.remoteport);
    if (autoconfNet) {
      yield Q.nbind(wiz.networkReconfiguration, wiz)(conf, autoconfNet, program.noupnp);
    }
    const hasSaltPasswdKey = conf.salt && conf.passwd;
    const hasKeyPair = conf.pair && conf.pair.pub && conf.pair.sec;
    const autoconfKey = program.autoconf || (!hasSaltPasswdKey && !hasKeyPair);
    if (autoconfKey) {
      yield Q.nbind(wiz.keyReconfigure, wiz)(conf, autoconfKey);
    }
    // Try to add an endpoint if provided
    if (program.addep) {
      if (conf.endpoints.indexOf(program.addep) === -1) {
        conf.endpoints.push(program.addep);
      }
      // Remove it from "to be removed" list
      const indexInRemove = conf.rmEndpoints.indexOf(program.addep);
      if (indexInRemove !== -1) {
        conf.rmEndpoints.splice(indexInRemove, 1);
      }
    }
    // Try to remove an endpoint if provided
    if (program.remep) {
      if (conf.rmEndpoints.indexOf(program.remep) === -1) {
        conf.rmEndpoints.push(program.remep);
      }
      // Remove it from "to be added" list
      const indexInToAdd = conf.endpoints.indexOf(program.remep);
      if (indexInToAdd !== -1) {
        conf.endpoints.splice(indexInToAdd, 1);
      }
    }
    return server.dal.saveConf(conf)
      .then(function () {
        try {
          logger.debug("Configuration saved.");
          return conf;
        } catch (e) {
          logger.error("Configuration could not be saved: " + e);
          throw Error(e);
        }
      });
  });
}
