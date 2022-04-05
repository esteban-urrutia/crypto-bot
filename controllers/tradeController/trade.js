const tradeController_info =    require("./info");
const tradeController_actions = require("./actions");
const telegramController =      require("./../telegramController");
const miniDBcontroller =        require("./../miniDBcontroller");
const utils =                   require("./../../utils/utils");
const miniDBController = require("../miniDBcontroller");
const env =                     require('dotenv').config().parsed;
const log =                     require('./../logController').getInstance();

async function trade(telegram, SEMAPHORE_miniDB) {
    return new Promise(async (resolve, reject) => {

        // read miniDB
        await miniDBcontroller.readMiniDB(SEMAPHORE_miniDB)
            .then(async (miniDB) => {

                // if trading IS enabled
                if(miniDB.tradeEnabled){

                    // if IP IS NOT banned
                    if(utils.getTimeStamp() > miniDB.ipBanUntil){

                        // select the best symbol to invest
                        await (new Promise(async (innerResolve) => {

                            // if symbol IS already selected
                            if(miniDB.activeSymbol){
                                innerResolve(true);
                            }

                            // if symbol IS NOT selected  and  static symbol IS NOT found
                            else if(!miniDB.activeSymbol  &&  !env.trade_staticAsset){
                                await tradeController_info.getBestSymbolToInvest()
                                    .then(async (bestAssetToInvest) => {

                                        if(bestAssetToInvest){

                                            // if this is the first trade of program
                                            if(!miniDB.buyOrdersFilled){ miniDB.timestampStartRoundOfTrade = utils.getTimeStamp() }

                                            miniDB.selectedSymbol = bestAssetToInvest;
                                            miniDB.activeSymbol =   true;
                                            await miniDBController.saveMiniDB(SEMAPHORE_miniDB, miniDB)
                                                .catch(async (error) => {
                                                    reject(error);
                                                })
                                                .finally(async () => {

                                                    await telegramController.sendMessage(telegram, "New Dynamic exchange symbol\n\nAsset:  "+miniDB.selectedSymbol.replace(env.trade_fiat,'') + "\nFiat:  "+env.trade_fiat, "text")
                                                        .catch(async (telegramError) => {
                                                            await log.save(telegramError,"error");
                                                        })

                                                    innerResolve(true);
                                                })
                                        }
                                        else{
                                            innerResolve(false);
                                        }
                                    })
                                    .catch((error) => {
                                        reject(error);
                                    })
                            }

                            // if symbol IS NOT selected  and  static symbol IS found
                            else if(!miniDB.activeSymbol  &&  env.trade_staticAsset){

                                    // if this is the first trade of program
                                    if(!miniDB.buyOrdersFilled){ miniDB.timestampStartRoundOfTrade = utils.getTimeStamp() }

                                    miniDB.selectedSymbol = env.trade_staticAsset+env.trade_fiat;
                                    miniDB.activeSymbol =   true;
                                    await miniDBController.saveMiniDB(SEMAPHORE_miniDB, miniDB)
                                        .catch(async (error) => {
                                            reject(error);
                                        })
                                        .finally(async () => {

                                            await telegramController.sendMessage(telegram, "New Static exchange symbol\n\nAsset:  "+miniDB.selectedSymbol.replace(env.trade_fiat,'') + "\nFiat:  "+env.trade_fiat, "text")
                                                .catch(async (telegramError) => {
                                                    await log.save(telegramError,"error");
                                                })

                                            innerResolve(true);
                                        })
                            }
                        }))
                        .finally(async () => {

                            // if symbol WAS selected
                            if(miniDB.activeSymbol){

                                // get exchangeInfo of asset
                                await tradeController_info.getExchangeInfo(miniDB.selectedSymbol)
                                    .then(async (exchangeInfo) => {

                                        // get price of asset, fiat
                                        await tradeController_info.getAssetFiatPrice(miniDB.selectedSymbol)
                                            .then(async (assetFiatPrice) => {

                                                // get the last order status
                                                await tradeController_info.getLastOrder(miniDB)
                                                    .then(async (lastOrder) => {

                                                        // get elEssePatternSignal
                                                        await tradeController_info.elEssePatternSignal(miniDB.selectedSymbol, miniDB, assetFiatPrice, telegram)
                                                            .then(async (elEssePatternSignal) => {

                                                                // check if lastOrder is FILLED, CANCELED, PENDING or DON´T exist
                                                                await tradeController_actions.checkLastOrderStatus(lastOrder, assetFiatPrice, exchangeInfo, telegram, SEMAPHORE_miniDB, miniDB, elEssePatternSignal)
                                                                    .then(async (lastOrderStillActiveOrSymbolNotActive) => {

                                                                        // if last order IS still active  or  symbol WAS NOT selected... do nothing
                                                                        if(lastOrderStillActiveOrSymbolNotActive){
                                                                            resolve(false);
                                                                        }

                                                                        // if last order is not active... trade
                                                                        else{
                                                                            // get account balance of asset, fiat
                                                                            await tradeController_info.getAccountBalances(miniDB.selectedSymbol)
                                                                                .then(async (accountBalance) => {

                                                                                    // if this IS the first time trading this asset... place initial BUY order
                                                                                    if(!lastOrder  &&  elEssePatternSignal === "BUY"){

                                                                                        await tradeController_actions.placeOrder("BUY", assetFiatPrice, accountBalance, exchangeInfo, telegram, miniDB, SEMAPHORE_miniDB)
                                                                                            .then(async (placedOrder) => {

                                                                                                // notify "initial order placed" over telegram
                                                                                                let notification = placedOrder.side+" "+placedOrder.symbol.replace(env.trade_fiat,'')+" initial order placed\n\norder: \n" + JSON.stringify(placedOrder, null, 4);
                                                                                                await telegramController.sendMessage(telegram, notification, "text")
                                                                                                    .then(() => {
                                                                                                        resolve(notification);
                                                                                                    })
                                                                                                    .catch(async (error) => {
                                                                                                        reject(error);
                                                                                                    })
                                                                                            })
                                                                                            .catch((error) => {
                                                                                                reject(error);
                                                                                            })
                                                                                    }


                                                                                    // if lastOrder was FILLED  and
                                                                                    //    (lastOrder.side = SELL  &&  elEssePatternSignal = BUY)  or  (lastOrder.side = BUY  &&  elEssePatternSignal = SELL)... place new order on opposite side
                                                                                    if( lastOrder  &&
                                                                                        ( lastOrder.status === 'FILLED'  &&
                                                                                            ( (lastOrder.side === 'SELL'  &&  elEssePatternSignal === "BUY")  ||  (lastOrder.side === 'BUY'  &&  elEssePatternSignal === "SELL")  ) ) ){

                                                                                        let newOrderSide;
                                                                                        switch (lastOrder.side){
                                                                                            case "BUY":  newOrderSide = "SELL"; break;
                                                                                            case "SELL": newOrderSide = "BUY";  break;
                                                                                        }

                                                                                        await tradeController_actions.placeOrder(newOrderSide, assetFiatPrice, accountBalance, exchangeInfo, telegram, miniDB, SEMAPHORE_miniDB)
                                                                                            .then(async (placedOrder) => {

                                                                                                // notify "order placed" over telegram
                                                                                                let notification = placedOrder.side +" "+ placedOrder.symbol.replace(env.trade_fiat,'')+" order placed\n\norder: \n" + JSON.stringify(placedOrder, null, 4);
                                                                                                await telegramController.sendMessage(telegram, notification, "text")
                                                                                                    .then(() => {
                                                                                                        resolve(notification);
                                                                                                    })
                                                                                                    .catch(async (error) => {
                                                                                                        reject(error);
                                                                                                    })
                                                                                            })
                                                                                            .catch((error) => {
                                                                                                reject(error);
                                                                                            })
                                                                                    }


                                                                                    // if last order was CANCELED  and
                                                                                    //     (lastOrder.side = SELL  &&  elEssePatternSignal = SELL)  or  (lastOrder.side = BUY  &&  elEssePatternSignal = BUY)... place new order on same side
                                                                                    else if( lastOrder  &&
                                                                                        ( lastOrder.status === 'CANCELED'  &&
                                                                                            ( lastOrder.side === 'BUY'  &&  elEssePatternSignal === "BUY"  ||  (lastOrder.side === 'SELL'  &&  elEssePatternSignal === "SELL") ) ) ){

                                                                                        await tradeController_actions.placeOrder(lastOrder.side, assetFiatPrice, accountBalance, exchangeInfo, telegram, miniDB, SEMAPHORE_miniDB)
                                                                                            .then(async (placedOrder) => {

                                                                                                // notify "order RE-placed" over telegram
                                                                                                let notification = placedOrder.side +" "+ placedOrder.symbol.replace(env.trade_fiat,'')+" order RE-placed\n\norder: \n" + JSON.stringify(placedOrder, null, 4);
                                                                                                await telegramController.sendMessage(telegram, notification, "text")
                                                                                                    .then(() => {
                                                                                                        resolve(notification);
                                                                                                    })
                                                                                                    .catch(async (error) => {
                                                                                                        reject(error);
                                                                                                    })
                                                                                            })
                                                                                            .catch((error) => {
                                                                                                reject(error);
                                                                                            })
                                                                                    }


                                                                                    // if elEssePatternSignal is not acceptable... do nothing
                                                                                    else{
                                                                                        resolve(false);
                                                                                    }
                                                                                })
                                                                                .catch((error) => {
                                                                                    reject(error);
                                                                                })
                                                                        }
                                                                    })
                                                                    .catch((error) => {
                                                                        reject(error);
                                                                    })
                                                            })
                                                            .catch(async (error) => {
                                                                reject(error);
                                                            })
                                                    })
                                                    .catch((error) => {
                                                        reject(error);
                                                    })
                                            })
                                            .catch((error) => {
                                                reject(error);
                                            })
                                    })
                                    .catch(async (error) => {
                                        reject(error);
                                    });
                            }

                            // if symbol WAS NOT selected
                            else{
                                resolve(false);
                            }
                        })
                    }

                    // if IP IS banned... do nothing
                    else{
                        resolve(false);
                    }
                }

                // if trading IS NOT enabled... do nothing
                else{
                    resolve(false);
                }
            })
            .catch((error) => {
                reject(error);
            })
    })
}

module.exports = {
    trade
};