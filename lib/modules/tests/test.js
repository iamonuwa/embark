const async = require('async');
const AccountParser = require('../../utils/accountParser');

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
    this.blockchainConnector = null;
    this.provider = null;
    this.accounts = [];
  }

  init(callback) {
    this.showNodeHttpWarning();

    this.events.request('blockchain:object', (connector) => {
      this.blockchainConnector = connector;
      callback();
    });
  }

  initWeb3Provider(callback) {
    if (this.simOptions.accounts) {
      this.simOptions.accounts = this.simOptions.accounts.map((account) => {
        if (!account.hexBalance) {
          account.hexBalance = '0x8AC7230489E80000'; // 10 ether
        }
        return {balance: account.hexBalance, secretKey: account.privateKey};
      });
    }

    // TODO use event for this
    if (!this.simOptions.host && (this.options.node && this.options.node === 'vm')) {
      this.simOptions.type = 'vm';
    }
    this.configObj.contractsConfig.deployment = this.simOptions;
    this.blockchainConnector.contractsConfig = this.configObj.contractsConfig;
    this.blockchainConnector.isWeb3Ready = false;
    this.blockchainConnector.wait = false;

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
      return callback(__("contracts config error: unknown deployment type %s", type));
    }

    if(accounts || port !== this.simOptions.port || type !== this.simOptions.type || host !== this.simOptions.host) {
      resetServices = true;
    }

    this.events.request("blockchain:get", (web3) => {
      if (accounts) {
        self.simOptions.accounts = AccountParser.parseAccountsConfig(accounts, web3);
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
        callback();
      });
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
        self.events.request('blockchain:getAccounts', (err, accounts) => {
          if (err) {
            return next(err);
          }
          self.accounts = accounts;
          self.events.request('blockchain:defaultAccount:set', accounts[0], () => {
            next(null, accounts);
          });
        });
      },
      function getBalance(accounts, next) {
        self.events.request('blockchain:getBalance', self.accounts[0], (err, balance) => {
          if (err) {
            return next(err);
          }
          if (parseInt(balance, 10) === 0) {
            self.logger.warn("Warning: default account has no funds");
          }
          next(null, accounts);
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

            self.events.request('blockchain:contract:create', {
              abi: contract.abiDefinition,
              address: contract.deployedAddress
            }, (newContract) => {
              if (newContract.options) {
                newContract.options.data = contract.code;
                newContract.options.from = accounts[0];
                if (!newContract.options.data.startsWith('0x')) {
                  newContract.options.data = '0x' + newContract.options.data;
                }
                newContract.options.gas = 6000000;
              }

              Object.setPrototypeOf(self.contracts[contract.className], newContract);

              eachCb();
            });
          }, (err) => {
            next(err, accounts);
          });

        });
      }
    ], function (err, accounts) {
      if (err) {
        self.logger.error(__('terminating due to error'));
        self.logger.error(err.message || err);
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
