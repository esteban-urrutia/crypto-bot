const log =                      require('./logController').getInstance();
const env =                      require('dotenv').config().parsed;
let   device =                   require('systeminformation');
const {exec} =                   require("child_process");
const miniDBController =         require("./miniDBcontroller");
const tradeController_info =     require("./tradeController/info");
const utils =                    require('./../utils/utils');
const lossPreventionController = require('./tradeController/lossPrevention')
const compress =                 require('compressing');
const fs =                       require('fs');

async function listenMessages(telegram, SEMAPHORE_miniDB){
    if (env.telegram_enabled === 'true'){
        return new Promise(async (resolve) => {

            // message handler
            let messageHandler = async (msg) => {

                // if type of message received is text
                if (msg.hasOwnProperty('text')) {

                    // log incoming message
                    let incomingMessage = {
                        from: {
                            firstName: msg.from.first_name,
                            lastName:  msg.from.last_name,
                            username:  msg.from.username
                        },
                        command: msg.text.slice(1)
                    };
                    await log.save(incomingMessage, "incomingTelegramMessages");

                    // process incoming message
                    let botNameOfThisRpi = incomingMessage.command.includes("@") ? "@"+env.telegram_botOf_thisRpi : "";
                    switch (incomingMessage.command) {

                        case "help" + botNameOfThisRpi:
                            await helpMenu(telegram);
                            break;

                        case "profitStatus" + botNameOfThisRpi:
                            await profitStatus(telegram, SEMAPHORE_miniDB);
                            break;

                        case "lastOrderStatus" + botNameOfThisRpi:
                            await lastOrderStatus(telegram, SEMAPHORE_miniDB);
                            break;

                        case "getLogs" + botNameOfThisRpi:
                            await getLogs(telegram);
                            break;

                        case "aliveReport" + botNameOfThisRpi:
                            await aliveReport(telegram);
                            break;

                        case "configMenu" + botNameOfThisRpi:
                            await configMenu(telegram, SEMAPHORE_miniDB);
                            break;

                        case "config_tradingStatus ON "+env.telegram_password +  botNameOfThisRpi:
                        case "config_tradingStatus OFF "+env.telegram_password + botNameOfThisRpi:
                            await changeTradingStatus(telegram, SEMAPHORE_miniDB, incomingMessage.command.split(' ')[1]);
                            break;

                        case "config_emergencyStop "+env.telegram_password + botNameOfThisRpi:
                            await emergencyStop(telegram, SEMAPHORE_miniDB);
                            break;

                        case "config_rebootService "+env.telegram_password + botNameOfThisRpi:
                            await rebootService(telegram);
                            break;

                        case "config_rebootRpi "+env.telegram_password + botNameOfThisRpi:
                            await rebootRpi(telegram);
                            break;
                    }
                }
            }

            // error handler
            let errorHandler = async (error) => {
                await log.save({
                    data:            null,
                    redirectedError: false,
                    errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                    from:            "telegramController -> errorHandler"
                }, "error");
            };

            telegram.on("message",       messageHandler);
            telegram.on("polling_error", errorHandler);
            telegram.on("webhook_error", errorHandler);
            telegram.on("error",         errorHandler);

            resolve(telegram);
        });
    }
}

async function sendMessage(telegram, message, type) {
    if (env.telegram_enabled === 'true') {
        return new Promise(async (resolve, reject) => {

            // send message according to specified type
            switch (type) {
                case 'text':
                    await telegram.sendMessage(env.telegram_chatId, message)
                        .then(() => {
                            resolve(true);
                        })
                        .catch(async (error) => {
                            reject({data:            {message: message.replace(/[\n]/g, ' '), type: type},
                                           redirectedError: false,
                                           errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                                           from:            "telegramController -> sendMessage -> text"});
                        })
                    break;

                case "document":
                    await telegram.sendDocument(env.telegram_chatId, message)
                        .then(async () => {
                            try{
                                await fs.unlinkSync(message);
                                resolve(true);
                            }
                            catch (error){
                                reject({data:            {message: message, type: type},
                                               redirectedError: false,
                                               errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                                               from:            "telegramController -> sendMessage -> document -> deleting from disk"});
                            }
                        })
                        .catch(async (error) => {
                            await telegram.sendMessage(env.telegram_chatId, "Error executing (send document):  " + error)
                                .catch(async (error) => {
                                    await log.save({
                                        data:            {message: message, type: type},
                                        redirectedError: false,
                                        errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                                        from:            "telegramController -> sendErrorMessage -> send document"
                                    }, "error");
                                })
                                .finally(() => {
                                    reject({data:            {message: message, type: type},
                                        redirectedError: false,
                                        errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                                        from:            "telegramController -> send document -> error"});
                                })
                        })
                    break

                case "image":
                    await telegram.sendPhoto(env.telegram_chatId, message)
                        .then(async () => {
                            try{
                                await fs.unlinkSync(message);
                                resolve(true);
                            }
                            catch (error){
                                reject({data:            {message: message, type: type},
                                               redirectedError: false,
                                               errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                                               from:            "telegramController -> sendMessage -> image -> deleting from disk"});
                            }
                        })
                        .catch(async (error) => {
                            await telegram.sendMessage(env.telegram_chatId, "Error executing (send image):  " + error)
                                .catch(async (error) => {
                                    await log.save({
                                        data:            {message: message, type: type},
                                        redirectedError: false,
                                        errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                                        from:            "telegramController -> sendErrorMessage -> send image"
                                    }, "error");
                                })
                                .finally(() => {
                                    reject({data:            {message: message, type: type},
                                        redirectedError: false,
                                        errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                                        from:            "telegramController -> send image -> error"});
                                })
                        })
                    break;
            }
        })
    }
}

async function restartConnection(telegram){
    if (env.telegram_enabled === 'true'){
        return new Promise(async (resolve, reject) => {

            await telegram.stopPolling()
                .then(async () =>{

                    await telegram.closeWebHook()
                        .then(async () => {

                            await telegram.startPolling({restart: true})
                                .then(async () => {

                                    await listenMessages(telegram)
                                        .then((response) => {
                                            resolve(response);
                                        });
                                })
                                .catch((error) => {
                                    reject({
                                        data:            null,
                                        redirectedError: false,
                                        errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                                        from:            "telegramController -> restartConnection -> telegram.stopPolling -> telegram.closeWebHook -> telegram.startPolling"
                                    })
                                })
                        })
                        .catch(async (error) => {
                            reject({
                                data:            null,
                                redirectedError: false,
                                errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                                from:            "telegramController -> restartConnection -> telegram.stopPolling -> telegram.closeWebHook"
                            })
                        });
                })
                .catch(async (error) => {
                    reject({
                        data:            null,
                        redirectedError: false,
                        errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                        from:            "telegramController -> restartConnection -> telegram.stopPolling()"
                    })
                });
        })
    }
}

async function helpMenu(telegram){

    let menu =  "Commands for  " + env.telegram_botOf_thisRpi + "\n\n\n" +
                "1)   /profitStatus\n\n" +
                "2)   /lastOrderStatus\n\n" +
                "3)   /getLogs\n\n" +
                "4)   /aliveReport\n\n" +
                "5)   /configMenu";

    // send helpMenu for this device
    await sendMessage(telegram, menu, "text")
        .catch(async (error) => {
            await log.save(error, "error")
        })
}

async function profitStatus(telegram, SEMAPHORE_miniDB){

    await miniDBController.readMiniDB(SEMAPHORE_miniDB)
        .then(async (miniDB) => {

            if(miniDB.lastOrder){
                // get account balance of asset, fiat
                await tradeController_info.getAccountBalances(miniDB.lastOrder.symbol)
                    .then(async (accountBalance) => {

                        // get price of asset, fiat
                        await tradeController_info.getAssetFiatPrice(miniDB.lastOrder.symbol)
                            .then(async (assetFiatPrice) => {

                                // calculate money in account assuming that all orders are canceled and all asset it's sell at current market price
                                let currentMoneyOnAccount = accountBalance.fiat + accountBalance.asset*assetFiatPrice;
                                if(miniDB.lastOrder  &&  miniDB.lastOrder.status === "PENDING"){
                                    if(miniDB.lastOrder.hasOwnProperty('assetToUse')){
                                        currentMoneyOnAccount = currentMoneyOnAccount + miniDB.lastOrder.assetToUse*assetFiatPrice;
                                    }
                                    else if(miniDB.lastOrder.hasOwnProperty('fiatToUse')){
                                        currentMoneyOnAccount = currentMoneyOnAccount + miniDB.lastOrder.fiatToUse;
                                    }
                                }

                                let daysPassedFromRoundStart = (miniDB.timestampStartRoundOfTrade) ? Math.floor((utils.getTimeStamp() - miniDB.timestampStartRoundOfTrade)/(60*60*24)): 1;
                                let totalProfit =              (currentMoneyOnAccount-Number(env.trade_initialMoneyOnUSD));
                                let totalProfitPercentage =    ((currentMoneyOnAccount*100)/Number(env.trade_initialMoneyOnUSD)) -100;

                                let profitStatus =  "Profit status\n\n\n" +
                                    "Initial money on this round:\n"+ env.trade_initialMoneyOnUSD+"  USD\n\n" +
                                    "Current money on account\n(if all asset is sell at market price)\n"+     currentMoneyOnAccount.toFixed(2)+"  USD\n\n" +
                                    env.trade_fiat + " balance:  " + accountBalance.fiat + "\n" + miniDB.lastOrder.symbol.replace(env.trade_fiat,'') + " balance:    " + accountBalance.asset+"\n\n"+
                                    ((miniDB.sellOrdersFilled > 0  &&  miniDB.buyOrdersFilled > 0) ? (
                                        "_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _\n" +
                                        "Round started on:     \n    "+utils.getDateStampFromTimeStamp(miniDB.timestampStartRoundOfTrade)+"\n    ( "+daysPassedFromRoundStart+" days ago )\n\n"+
                                        "Sell orders filled:  "+ miniDB.sellOrdersFilled+"\n"+
                                        "Buy  orders filled:  "+ miniDB.buyOrdersFilled+"\n\n"+
                                        "Total profit: "+        totalProfit.toLocaleString()+ "  USD ("+totalProfitPercentage.toLocaleString()+" %)\n\n") +
                                        "Theoretical Total profit\n(% sum of all profits): "+miniDB.profits .toLocaleString()+" %\n\n"+
                                    (daysPassedFromRoundStart > 0 ? (
                                        "Average profit per:\n" +
                                        "    1 day:       "+(totalProfit/daysPassedFromRoundStart).toLocaleString()+          "  USD ("+(totalProfitPercentage/daysPassedFromRoundStart).toLocaleString()+" %)\n" +
                                        "    1 week:    "+   (7*totalProfit/(daysPassedFromRoundStart)).toLocaleString()+      "  USD ("+(7*totalProfitPercentage/daysPassedFromRoundStart).toLocaleString()+" %)\n" +
                                        "    1 month:  "+   (30.416*totalProfit/(daysPassedFromRoundStart)).toLocaleString()+ "  USD ("+(30.416*totalProfitPercentage/daysPassedFromRoundStart).toLocaleString()+" %)\n" +
                                        "    6 month:  "+   (182.5*totalProfit/(daysPassedFromRoundStart)).toLocaleString()+  "  USD ("+(182.5*totalProfitPercentage/daysPassedFromRoundStart).toLocaleString()+" %)\n" +
                                        "    1 year:       "+ (365*totalProfit/(daysPassedFromRoundStart)).toLocaleString()+  "  USD ("+(365*totalProfitPercentage/daysPassedFromRoundStart).toLocaleString()+" %)\n\n" +
                                        "Money on account projection for:\n    1 day:         "+ (Math.round(currentMoneyOnAccount+(totalProfit/daysPassedFromRoundStart))).toLocaleString() +        "  USD\n" +
                                        "    1 week:     "+    (Math.round(currentMoneyOnAccount+(7*totalProfit/daysPassedFromRoundStart))).toLocaleString() +      "  USD\n" +
                                        "    1 month:  "+    (Math.round(currentMoneyOnAccount+(30.416*totalProfit/daysPassedFromRoundStart))).toLocaleString() + "  USD\n" +
                                        "    6 month:  "+    (Math.round(currentMoneyOnAccount+(182.5*totalProfit/daysPassedFromRoundStart))).toLocaleString() +  "  USD\n" +
                                        "    1 year:       "+ (Math.round(currentMoneyOnAccount+(365*totalProfit/daysPassedFromRoundStart))).toLocaleString() +    "  USD") : "")  : "");

                                // send helpMenu for this device
                                await sendMessage(telegram, profitStatus, "text")
                                    .catch(async (error) => {
                                        await log.save(error, "error")
                                    })
                            })
                            .catch(async (error) => {
                                await log.save(error, "error")
                            })
                    })
                    .catch(async (error) => {
                        await log.save(error, "error")
                    })
            }
            else{
                // send helpMenu for this device
                await sendMessage(telegram, "Profit status\n\n\nInitial order still not placed", "text")
                    .catch(async (error) => {
                        await log.save(error, "error")
                    })
            }

        })
        .catch(async (error) => {
            await log.save(error, "error")
        })
}

async function lastOrderStatus(telegram, SEMAPHORE_miniDB){

    await miniDBController.readMiniDB(SEMAPHORE_miniDB)
        .then(async (miniDB) => {

            if(miniDB.lastOrder){

                await tradeController_info.getLastOrder(miniDB)
                    .then(async (lastOrder) => {

                        // get price of asset, fiat
                        await tradeController_info.getAssetFiatPrice(miniDB.lastOrder.symbol)
                            .then(async (assetFiatPrice) => {
                                let profitOrLoss = (miniDB.lastOrder  &&  miniDB.lastOrder.status === "FILLED"  &&  miniDB.lastOrder.side === "BUY") ? ((((assetFiatPrice*100)/miniDB.lastOrder.price)-100)-Number(env.trade_exchangeFeePercentage)).toFixed(2): null;
                                let lastOrderStatus = "Last Order Status\n\n" +
                                                      "lastOrder:\n"+JSON.stringify({dateStamp:( utils.getDateStampFromTimeStamp(Math.floor(lastOrder.time/1000)) ), symbol:lastOrder.symbol, type: lastOrder.type, side:lastOrder.side, price:lastOrder.price, quantity:lastOrder.origQty, status:lastOrder.status}, null, 4)+"\n\n"+
                                                      "current assetFiat price:  "+ assetFiatPrice + "\n"+
                                                      (profitOrLoss ? (profitOrLoss > 0 ? "( Above " : "( Below  ")+profitOrLoss+" %)\n": "")+"\n"+
                                                      "price chart: www.tradingview.com/chart/dz9PZLz3/?symbol=BINANCE%3A"+miniDB.lastOrder.symbol;

                                await sendMessage(telegram, lastOrderStatus, "text")
                                    .catch(async (error) => {
                                        await log.save(error, "error")
                                    })
                            })
                            .catch(async (error) => {
                                await log.save(error, "error")
                            })
                    })
                    .catch(async (error) => {
                        await log.save(error, "error")
                    })
            }
            else{
                await sendMessage(telegram, "Last Order Status\n\n\nInitial order still not placed", "text")
                    .catch(async (error) => {
                        await log.save(error, "error")
                    })
            }
        })
        .catch(async (error) => {
            await log.save(error, "error")
        })
}

async function aliveReport(telegram){
    let responseArray   =  [];
    let last_boot       =  "";
    let ips             =  "";

    // Get network interfaces of the device
    await device.networkInterfaces()
        .then(async (network) => {
            network.forEach(net => {
                if(net.ifaceName !== 'lo') {
                    ips += net.ifaceName + ": \n" + net.ip4 + "\n\n";
                }
            });

            // get time since boot
            await exec("uptime -s", async function(error, data) {
                last_boot = data;
                if(error) {
                    last_boot = 'Error: ' + error.message;
                }
                responseArray.push(env.telegram_botOf_thisRpi + ": I'm alive! \n\n\n" + ips + "Last Boot: \n" + last_boot);

                // send aliveReport
                for (const res of responseArray) {
                    await sendMessage(telegram, res, "text")
                        .catch(async (error) => {
                            await log.save(error, "error")
                        })
                }
            })
        })
        .catch(async (error) => {
            error = {data:            "aliveReport",
                     redirectedError: false,
                     errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                     from:            "telegramController -> aliveReport -> networkInterfaces"}
            await log.save(error, "error");

            await sendMessage(telegram, error.errorMessage, "text")
                .catch(async (telegramError) => {
                    await log.save(telegramError, "error")
                })
        })
}

async function configMenu(telegram, SEMAPHORE_miniDB){

    await miniDBController.readMiniDB(SEMAPHORE_miniDB)
        .then(async (miniDB) => {

            // if selectedSymbol is defined... get price of asset, fiat
            await (new Promise(async (innerResolve) => {

                if(miniDB.lastOrder){
                    await tradeController_info.getAssetFiatPrice(miniDB.lastOrder.symbol)
                        .then(async (assetFiatPrice) => {
                            innerResolve(assetFiatPrice);
                        })
                        .catch(async (error) => {
                            await log.save(error, "error")
                        })
                }
                else{
                    innerResolve(null);
                }
            }))
            .catch(async (error) => {
                await log.save(error, "error")
            })
            .then(async (assetFiatPrice) => {

                let profitOrLossIfEmergencyStopIsExecuted = (miniDB.lastOrder  &&  miniDB.lastOrder.status === "FILLED"  &&  miniDB.lastOrder.side === "BUY") ? ((((assetFiatPrice*100)/miniDB.lastOrder.price)-100)-Number(env.trade_exchangeFeePercentage)).toFixed(2): null;

                let configMenu = "Config Menu\n\n" +
                    "TradingStatus:      "+(miniDB.tradeEnabled ? "ON" : "OFF")+"\n"+
                    (miniDB.ipBanUntil ? ("\nIP BAN until: "+utils.getDateStampFromTimeStamp(miniDB.ipBanUntil)): "")+"\n\n"+
                    "/config_tradingStatus ON/OFF password\n\n"+
                    "/config_emergencyStop password\n"+
                    (profitOrLossIfEmergencyStopIsExecuted ? (profitOrLossIfEmergencyStopIsExecuted > 0 ? "( Profit of " : "( Loss of  ")+profitOrLossIfEmergencyStopIsExecuted+" %  if executed )\n": "")+"\n"+
                    "/config_rebootService password\n\n"+
                    "/config_rebootRpi password";
                // send configMenu
                await sendMessage(telegram, configMenu, "text")
                    .catch(async (error) => {
                        await log.save(error, "error")
                    })
            })
        })
}

async function changeTradingStatus(telegram, SEMAPHORE_miniDB, tradingStatus){

    if(tradingStatus === "ON"  ||  tradingStatus === "OFF"){

        await miniDBController.updateMiniDB(SEMAPHORE_miniDB, "tradeEnabled", (tradingStatus === "ON"))
            .then(async () => {

                // send helpMenu for this device
                await sendMessage(telegram, "Trading "+((tradingStatus === "ON") ? "Enabled" : "Disabled"), "text")
                    .catch(async (error) => {
                        await log.save(error, "error")
                    })
            })
            .catch(async (error) => {
                await log.save(error, "error");
            })
    }
}

async function emergencyStop(telegram, SEMAPHORE_miniDB){

    await lossPreventionController.cancelAllOpenOrdersAndSellAsset(telegram, SEMAPHORE_miniDB)
        .then(async () => {

            await sendMessage(telegram, "EMERGENCY STOP EXECUTED\n\nAll orders were cancel and all asset was SELL", "text")
                .catch(async (error) => {
                    await log.save(error, "error")
                })
        })
        .catch(async (error) => {
            await log.save(error, "error");

            await sendMessage(telegram, "ERROR EXECUTING EMERGENCY STOP\n\nError:\n"+JSON.stringify(error, null, 4), "text")
                .catch(async (telegramError) => {
                    await log.save(telegramError, "error")
                })
        })
}

async function rebootService(telegram){

    await telegram.sendMessage(env.telegram_chatId, "Service Rebooting")
        .catch(async (error) => {
            await log.save({data:            null,
                            redirectedError: false,
                            errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                            from:            "rebootRpi -> rebooting"}, "error");
        })
        .finally(async () => {
            await exec("pm2 restart main", async function (error) {
                if (error) {
                    await telegram.sendMessage(env.telegram_chatId, "Error executing (pm2 restart main):  " + error)
                        .catch(async (error) => {
                            await log.save({
                                data:            "Error executing (pm2 restart main):  " + error,
                                redirectedError: false,
                                errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                                from:            "telegramController -> sendErrorMessage -> pm2 restart main"
                            }, "error");
                        })
                }
            })
        })
}

async function rebootRpi(telegram){

    await telegram.sendMessage(env.telegram_chatId, "Rpi rebooting")
        .catch(async (error) => {
            await log.save({data:            null,
                            redirectedError: false,
                            errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                            from:            "rebootRpi -> rebooting"}, "error");
        })
        .finally(async () => {
            await exec("sudo reboot now", async function (error) {
                if (error) {
                    await telegram.sendMessage(env.telegram_chatId, "Error executing (sudo reboot now):  " + error)
                        .catch(async (error) => {
                            await log.save({
                                data:            "Error executing (pm2 restart main):  " + error,
                                redirectedError: false,
                                errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                                from:            "telegramController -> sendErrorMessage -> sudo reboot now"
                            }, "error");
                        })
                }
            })
        })
}

async function getLogs(telegram){
    return new Promise(async (resolve, reject) => {

        let compressedLogs = "log_"+utils.getDateStamp().replace(/[:]/g,'.')+".zip";

        await compress.zip.compressDir("logs", compressedLogs)
            .then(async () => {

                await sendMessage(telegram, compressedLogs, "document")
                    .catch(async (error) => {
                        await log.save(error, "error")
                    })
            })
            .catch((error) => {
                reject({
                    data:            null,
                    redirectedError: false,
                    errorMessage:    (error.hasOwnProperty('stack') ? error.stack : error),
                    from:            "telegramController -> all_logsInZip -> compress.zip.compressDir"
                });
            })
    });
}

module.exports = {
    listenMessages,
    restartConnection,
    sendMessage
}