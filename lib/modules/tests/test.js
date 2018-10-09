const async = require('async');
// const Engine = require('../../core/engine.js');
// const TestLogger = require('./test_logger.js');
// const Web3 = require('web3');
const AccountParser = require('../../utils/accountParser');
// TODO: breaks module isolation; tests need to be refactored to use the engine and avoid this
const Provider = require('../blockchain_connector/provider.js');
const utils = require('../../utils/utils');

const EmbarkJS = require('embarkjs');

class Test {
  constructor(options) {
    this.options = options || {};
    this.simOptions = {};
    this.events = options.events;
    this.logger = options.logger;
    this.configObj = options.config;
    this.ready = true;
    this.firstRunConfig = true;
    this.error = false;
    this.contracts = {};
    this.firstDeployment = true;
    this.needConfig = true;
    this.web3 = null;
    this.blockchainConnector = null;
    this.provider = null;
    this.accounts = [];

    /*this.engine = new Engine({
      env: this.options.env || 'test',
      // TODO: config will need to detect if this is a obj
      embarkConfig: this.options.embarkConfig || 'embark.json',
      interceptLogs: false
    });*/
  }

  init(callback) {
    this.showNodeHttpWarning();

    this.events.request('blockchain:object', (connector) => {
      this.blockchainConnector = connector;
      // TODO use events instead of using web3 directly?
      this.web3 = this.blockchainConnector.web3;
      callback();
    });

    /*let self = this;
    async.waterfall([
      function initEngine(cb) {
        self.engine.init({
          logger: new TestLogger({logLevel: self.options.loglevel})
        }, cb);
      },
      function startServices(cb) {
        self.versions_default = self.engine.config.contractsConfig.versions;
        // Reset contract config to nothing to make sure we deploy only what we want
        self.engine.config.contractsConfig = {
          contracts: {},
          versions: self.versions_default
        };

        self.engine.startService("libraryManager");
        self.engine.startService("codeRunner");
        self.initDeployServices();
        self.engine.startService("codeGenerator");
        self.engine.startService("codeCoverage");

        if (self.options.node === 'embark') {
          if (!self.engine.ipc.connected) {
            self.engine.logger.error("Could not connect to Embark's IPC. Is embark running?");
            process.exit(1);
          }
          return self.connectToIpcNode(cb);
        }
        self.showNodeHttpWarning();
        cb();
      }
    ], callback);*/
  }

  initWeb3Provider(callback) {
    const self = this;
    if (this.provider) {
      this.provider.stop();
    }

    if (this.simOptions.accounts) {
      this.simOptions.accounts = this.simOptions.accounts.map((account) => {
        if (!account.hexBalance) {
          account.hexBalance = '0x8AC7230489E80000'; // 10 ether
        }
        return {balance: account.hexBalance, secretKey: account.privateKey};
      });
    }

    // TODO use event for this
    if (!this.simOptions.host || (this.options.node && this.options.node === 'vm')) {
      this.simOptions.type = 'vm';
    }
    this.configObj.contractsConfig.deployment = this.simOptions;
    this.blockchainConnector.contractsConfig = this.configObj.contractsConfig;
    this.blockchainConnector.isWeb3Ready = false;

    // TODO change this
    if (this.simOptions.host || (this.options.node && this.options.node !== 'vm')) {
      let options = this.simOptions;
      if (this.options.node) {
        options = utils.deconstructUrl(this.options.node);
      }

      let {host, port, type, protocol, accounts} = options;
      if (!protocol) {
        protocol = (options.type === "rpc") ? 'http' : 'ws';
      }
      const endpoint = `${protocol}://${host}:${port}`;
      const providerOptions = {
        web3: this.web3,
        type,
        accountsConfig: accounts,
        blockchainConfig: this.configObj.blockchainConfig,
        logger: this.logger,
        isDev: false,
        web3Endpoint: endpoint
      };
      console.info(`Connecting to node at ${endpoint}`.cyan);

      return utils.pingEndpoint(host, port, type, protocol, this.configObj.blockchainConfig.wsOrigins.split(',')[0], (err) => {
        if (err) {
          console.error(`Error connecting to the node, there might be an error in ${endpoint}`.red);
          return callback(err);
        }

        self.provider = new Provider(providerOptions);
        return self.provider.startWeb3Provider((err) => {
          if (err) {
            return callback(err);
          }
          callback();
        });
      });
    }

    // if (!this.sim) {
    //   this.sim = getSimulator();
    // }

    // let simProvider = this.sim.provider(this.simOptions);

    // TODO change this
    /*if (this.options.coverage) {
      // Here we patch the sendAsync method on the provider. The goal behind this is to force pure/constant/view calls to become
      // transactions, so that we can pull in execution traces and account for those executions in code coverage.
      //
      // Instead of a simple call, here's what happens:
      //
      // 1) A transaction is sent with the same payload, and a pre-defined gas price;
      // 2) We wait for the transaction to be mined by asking for the receipt;
      // 3) Once we get the receipt back, we dispatch the real call and pass the original callback;
      //
      // This will still allow tests to get the return value from the call and run contracts unmodified.
      simProvider.realSendAsync = simProvider.sendAsync.bind(simProvider);
      simProvider.sendAsync = function(payload, cb) {
        if(payload.method !== 'eth_call') {
          return simProvider.realSendAsync(payload, cb);
        }
        self.events.request('reporter:toggleGasListener');
        let newParams = Object.assign({}, payload.params[0], {gasPrice: '0x77359400'});
        let newPayload = {
            id: payload.id + 1,
            method: 'eth_sendTransaction',
            params: [newParams],
            jsonrpc: payload.jsonrpc
        };

        simProvider.realSendAsync(newPayload, (_err, response) => {
          let txHash = response.result;
          self.web3.eth.getTransactionReceipt(txHash, (_err, _res) => {
            self.events.request('reporter:toggleGasListener');
            simProvider.realSendAsync(payload, cb);
          });
        });
      };
    }*/

    this.blockchainConnector.initWeb3(callback);
    // this.web3.setProvider(simProvider);
    // callback();
  }

  /*initDeployServices() {
    this.engine.startService("web3", {
      web3: this.web3
    });
    this.engine.startService("deployment", {
      trackContracts: false,
      compileOnceOnly: true,
      disableOptimizations: true
    });
    this.gasLimit = 6000000;
    this.engine.events.request('deploy:setGasLimit', this.gasLimit);
  }*/

  /*connectToIpcNode(cb) {
    this.engine.ipc.request('blockchain:node', {}, (err, node) => {
      if (err) {
        this.engine.logger.error(err.message || err);
        return cb();
      }
      this.options.node = node;
      this.showNodeHttpWarning();
      cb();
    });
  }*/

  showNodeHttpWarning() {
    if (this.options.node.startsWith('http')) {
      this.logger.warn("You are using http to connect to the node, as a result the gas details won't be correct." +
                              " For correct gas details reporting, please use a websockets connection to your node.");
    }
  }

  onReady(callback) {
    const self = this;
    if (this.ready) {
      return callback();
    }
    if (this.error) {
      return callback(this.error);
    }

    let errorCallback, readyCallback;

    errorCallback = (err) => {
      self.events.removeListener('tests:ready', readyCallback);
      callback(err);
    };

    readyCallback = () => {
      self.events.removeListener('tests:deployError', errorCallback);
      callback();
    };

    this.events.once('tests:ready', readyCallback);
    this.events.once('tests:deployError', errorCallback);
  }

  checkDeploymentOptions(options, callback) {
    const self = this;
    let resetServices = false;
    const {host, port, type, accounts} = options.deployment || {};

    if (host && port && !['rpc', 'ws'].includes(type)) {
      callback(__("contracts config error: unknown deployment type %s", type));
    }

    if(accounts || port !== this.simOptions.port || type !== this.simOptions.type || host !== this.simOptions.host) {
      resetServices = true;
    }
    if (accounts) {
      self.simOptions.accounts = AccountParser.parseAccountsConfig(accounts, self.web3);
    } else {
      self.simOptions.accounts = null;
    }

    Object.assign(self.simOptions, {
      host,
      port,
      type
    });

    if (!resetServices && !self.firstRunConfig) {
      return callback();
    }

    self.initWeb3Provider((err) => {
      if (err) {
        return callback(err);
      }
      self.firstRunConfig = false;
      // self.initDeployServices();
      callback();
    });
  }

  config(options, callback) {
    const self = this;
    self.needConfig = false;
    if (typeof (options) === 'function') {
      callback = options;
      options = {};
    }
    if (!callback) {
      callback = function () {
      };
    }
    if (!options.contracts) {
      options.contracts = {};
    }
    self.ready = false;

    async.waterfall([
      function checkDeploymentOpts(next) {
        self.checkDeploymentOptions(options, next);
      },
      function compileContracts(next) {
        if (!self.firstDeployment) {
          return next();
        }
        self.logger.info('Compiling contracts'.cyan);
        self.events.request("contracts:build", false, (err) => {
          self.firstDeployment = false;
          next(err);
        });
      },
      function resetContracts(next) {
        self.events.request("contracts:reset:dependencies", next);
      },
      function deploy(next) {
        self._deploy(options, (err, accounts) => {
          if (err) {
            self.events.emit('tests:deployError', err);
            self.error = err;
            return next(err);
          }
          self.ready = true;
          self.error = false;
          self.events.emit('tests:ready');
          next(null, accounts);
        });
      }
    ], (err, accounts) => {
      if (err) {
        // TODO Do not exit in case of not a normal run (eg after a change)
        process.exit(1);
      }
      callback(null, accounts);
    });
  }

  _deploy(config, callback) {
    const self = this;
    async.waterfall([
      function getConfig(next) {
        // TODO use events instead of modifying directly
        self.configObj.contractsConfig = {contracts: config.contracts, versions: self.versions_default};
        next();
      },
      function getAccounts(next) {
        self.web3.eth.getAccounts(function (err, accounts) {
          if (err) {
            return next(err);
          }
          self.accounts = accounts;
          self.web3.eth.defaultAccount = accounts[0];
          next(null, accounts);
        });
      },
      function getBalance(accounts, next) {
        self.web3.eth.getBalance(self.web3.eth.defaultAccount).then((balance) => {
          if (parseInt(balance, 10) === 0) {
            self.logger.warn("Warning: default account has no funds");
          }
          next(null, accounts);
        }).catch((err) => {
          next(err);
        });
      },
      function deploy(accounts, next) {
        self.events.request('deploy:contracts:test', () => {
          next(null, accounts);
        });
      },
      function createContractObject(accounts, next) {
        self.events.request('contracts:all', (err, contracts) => {

          async.each(contracts, (contract, eachCb) => {
            if (!self.contracts[contract.className]) {
              self.contracts[contract.className] = {};
            }

            let newContract = new EmbarkJS.Blockchain.Contract({
              abi: contract.abiDefinition,
              address: contract.deployedAddress,
              from: self.web3.eth.defaultAccount,
              gas: 6000000,
              web3: self.web3
            });

            if (newContract.options) {
              newContract.options.from = self.web3.eth.defaultAccount;
              newContract.options.data = contract.code;
              if (!newContract.options.data.startsWith('0x')) {
                newContract.options.data = '0x' + newContract.options.data;
              }
              newContract.options.gas = 6000000;
            }

            Object.setPrototypeOf(self.contracts[contract.className], newContract);

            eachCb();
          }, (err) => {
            next(err, accounts);
          });

        });
      }
    ], function (err, accounts) {
      if (err) {
        self.logger.log(__('terminating due to error'));
        return callback(err);
      }
      callback(null, accounts);
    });
  }

  require(path) {
    const prefix = 'Embark/contracts/';
    if (!path.startsWith(prefix)) {
      throw new Error(__('Unknown module %s', path));
    }
    let contractName = path.replace(prefix, "");
    let contract = this.contracts[contractName];
    if (contract) {
      return contract;
    }

    let newContract = {};
    this.contracts[contractName] = newContract;
    return newContract;
  }
}

module.exports = Test;
