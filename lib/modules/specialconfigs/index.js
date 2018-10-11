const stringReplaceAsync = require('string-replace-async');
const async = require('async');

class SpecialConfigs {

  constructor(embark, options) {
    this.logger = embark.logger;
    this.events = embark.events;
    this.buildDir = options.buildDir;
    this.embark = embark;
    this.config = embark.config;

    this.registerAfterDeployAction();
    this.registerOnDeployAction();
    this.registerDeployIfAction();
  }

  replaceWithAddresses(cmd, cb) {
    const self = this;
    let regex = /\$\w+/g;
    stringReplaceAsync.seq(cmd, regex, (match) => {
      return (new Promise((resolve, reject) => {
        let referedContractName = match.slice(1);
        self.events.request('contracts:contract', referedContractName, (referedContract) => {
          if (!referedContract) {
            self.logger.error(referedContractName + ' does not exist');
            self.logger.error("error running cmd: " + cmd);
            return reject(new Error("ReferedContractDoesNotExist"));
          }
          if (referedContract && referedContract.deploy === false) {
            self.logger.error(referedContractName + " exists but has been set to not deploy");
            self.logger.error("error running cmd: " + cmd);
            return reject(new Error("ReferedContracSetToNotdeploy"));
          }
          if (referedContract && !referedContract.deployedAddress) {
            self.logger.error("couldn't find a valid address for " + referedContractName + ". has it been deployed?");
            self.logger.error("error running cmd: " + cmd);
            return reject(new Error("ReferedContractAddressNotFound"));
          }
          return resolve(referedContract.deployedAddress);
        });
      }));
    }).then((result) => {
      cb(null, result);
    }).catch(cb);
  }

  registerAfterDeployAction() {
    const self = this;

    this.embark.registerActionForEvent("contracts:deploy:afterAll", (cb) => {
      let afterDeployCmds = self.config.contractsConfig.afterDeploy || [];

      async.mapLimit(afterDeployCmds, 1, (cmd, nextMapCb) => {
        self.replaceWithAddresses(cmd, nextMapCb);
      }, (err, onDeployCode) => {
        if (err) {
          self.logger.trace(err);
          return cb(new Error("error running afterDeploy"));
        }

        self.runOnDeployCode(onDeployCode, cb);
      });
    });
  }

  runOnDeployCode(onDeployCode, callback, silent) {
    const self = this;
    const logFunction = silent ? self.logger.trace.bind(self.logger) : self.logger.info.bind(self.logger);
    async.each(onDeployCode, (cmd, eachCb) => {
      logFunction("==== executing: " + cmd);
      self.events.request('runcode:eval', cmd, (err) => {
        if (err && err.message.indexOf("invalid opcode") >= 0) {
          self.logger.error('the transaction was rejected; this usually happens due to a throw or a require, it can also happen due to an invalid operation');
        }
        eachCb(err);
      });
    }, callback);
  }

  registerOnDeployAction() {
    const self = this;

    this.embark.registerActionForEvent("deploy:contract:deployed", (params, cb) => {
      let contract = params.contract;

      if (!contract.onDeploy || contract.deploy === false) {
        return cb();
      }
      if (!contract.silent) {
        self.logger.info(__('executing onDeploy commands'));
      }

      let onDeployCmds = contract.onDeploy;

      async.mapLimit(onDeployCmds, 1, (cmd, nextMapCb) => {
        self.replaceWithAddresses(cmd, nextMapCb);
      }, (err, onDeployCode) => {
        if (err) {
          return cb(new Error("error running onDeploy for " + contract.className.cyan));
        }

        self.runOnDeployCode(onDeployCode, cb, contract.silent);
      });
    });
  }

  registerDeployIfAction() {
    const self = this;

    self.embark.registerActionForEvent("deploy:contract:shouldDeploy", (params, cb) => {
      let cmd = params.contract.deployIf;
      if (!cmd) {
        return cb(params);
      }

      self.events.request('runcode:eval', cmd, (err, result) => {
        if (err) {
          self.logger.error(params.contract.className + ' deployIf directive has an error; contract will not deploy');
          self.logger.error(err);
          params.shouldDeploy = false;
        } else if (!result) {
          self.logger.info(params.contract.className + ' deployIf directive returned false; contract will not deploy');
          params.shouldDeploy = false;
        }

        cb(params);
      });
    });
  }

}

module.exports = SpecialConfigs;
