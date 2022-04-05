const crypto =                   require('crypto');
const utils =                    require('./../../utils/utils');
const env =                      require('dotenv').config().parsed;
const superagent =               require('superagent');
const openPrice =                1;
const closePrice =               4;
let   lastSignal =               "AWAIT";
let   lastPossibleSellingPrice = 0;
const telegramController =       require("./../telegramController");
const log =                      require('./../logController').getInstance();

async function getExchangeInfo(symbol) {
    return new Promise(async (resolve, reject) => {
    
        await superagent.get(env.binance_url + "/exchangeInfo?symbol="+symbol)
            .set({"Content-Type": "application/json"})
            .timeout(15000)
            .then(async (response) => {

                // get the exchangeInfo for the symbol
                if (response.body.symbols[0].symbol === symbol) {

                    let exchangeInfo = {quoteAsset: response.body.symbols[0].quoteAsset,
                                        baseAsset: response.body.symbols[0].baseAsset};

                    // obtain filter values from the exchangeInfo
                    response.body.symbols[0].filters.forEach(filter => {
                        switch(filter.filterType){

                            case "LOT_SIZE":
                                exchangeInfo.minQty = (filter.minQty >= "1.00") ? Math.floor(Math.log10(filter.minQty)) : -Math.floor(Math.log10(filter.minQty));
                                break;

                            case "PRICE_FILTER":
                                exchangeInfo.quoteAssetPrecision = (filter.minPrice >= "1.00") ? Math.floor(Math.log10(filter.minPrice)) : -Math.floor(Math.log10(filter.minPrice));
                                break;

                            case "MIN_NOTIONAL":
                                exchangeInfo.minOrder = (filter.minNotional) ? filter.minNotional : filter.notional;
                                break;
                        }
                    });

                    resolve(exchangeInfo);
                }
                else{
                    reject({data:         symbol,
                                  errorMessage: "market not found",
                                  from:         "tradeController_info -> getExchangeInfo -> superagent.get -> get the exchangeInfo for the: " +symbol});
                }

            })
            .catch(async (error) => {
                error = utils.apiErrorHandler(error, {action: "getExchangeInfo", url: env.binance_url + "/exchangeInfo", header: {"Content-Type": "application/json"}});
                reject(error);
            })
    })
}

async function getLastOrder(miniDB){
    return new Promise(async (resolve, reject) => {

        if(miniDB.lastOrder){
            let dataToSign =   "symbol="+miniDB.lastOrder.symbol+"&recvWindow=60000&origClientOrderId="+miniDB.lastOrder.newClientOrderId+"&timestamp="+(Date.now()+parseInt(env.binance_serverTimeCorrection));
            let hmacSignature = crypto.createHmac('sha256', env.binance_secret).update(dataToSign).digest('hex');

            await superagent.get(env.binance_url + "/order?"+dataToSign+"&signature="+hmacSignature)
                .set({"Content-Type": "application/json", "X-MBX-APIKEY": env.binance_key})
                .timeout(15000)
                .then(async (response) => {
                    resolve(response.body);
                })
                .catch(async (error) => {
                    error = utils.apiErrorHandler(error, {action: "getLastOrder", url: env.binance_url + "/allOrders?"+dataToSign+"&signature="+hmacSignature, header: {"Content-Type": "application/json", "X-MBX-APIKEY": env.binance_secret}});
                    reject(error);
                })
        }
        else{
            resolve(null);
        }
    })
}

async function getAccountBalances(symbol){
    return new Promise(async (resolve, reject) => {

        let timeStampToSign = "timestamp="+(Date.now()+parseInt(env.binance_serverTimeCorrection));
        let hmacSignature =   crypto.createHmac('sha256', env.binance_secret).update(timeStampToSign).digest('hex');

        await superagent.get(env.binance_url + "/account?"+timeStampToSign+"&signature="+hmacSignature)
            .set({"Content-Type": "application/json", "X-MBX-APIKEY": env.binance_key})
            .timeout(15000)
            .then(async (response) => {

                let accountBalance = {};
                let asset = symbol.replace(env.trade_fiat,'');
                for(let i = 0; i < response.body.balances.length; i++){

                    switch(response.body.balances[i].asset) {
                        case asset:
                            accountBalance.asset = Number(response.body.balances[i].free);
                            break;

                        case env.trade_fiat:
                            accountBalance.fiat =  Number(response.body.balances[i].free);
                            break;
                    }
                }

                resolve(accountBalance);
            })
            .catch(async (error) => {
                error = utils.apiErrorHandler(error, {action: "getAccountBalances", url:    env.binance_url + "/account?"+timeStampToSign+"&signature="+hmacSignature, header: {"Content-Type": "application/json", "X-MBX-APIKEY": env.binance_secret}});
                reject(error);
            })
    })
}

async function getAssetFiatPrice(symbol){
    return new Promise(async (resolve, reject) => {

        // get candleStick data of last minute
        await superagent.get(env.binance_url + "/klines?symbol=" + symbol + "&interval=1m&limit=1")
            .set({"Content-Type": "application/json"})
            .timeout(15000)
            .then(async (response) => {
                resolve(Number(response.body[0][closePrice]));
            })
            .catch(async (error) => {
                error = utils.apiErrorHandler(error, {action: "getAssetFiatPrice", url: env.binance_url + "/ticker/price?symbol="+symbol, header: {"Content-Type": "application/json"}});
                reject(error);
            })
    })
}

async function getOpenOrders(symbol){
    return new Promise(async (resolve, reject) => {

        let dataToSign =    "symbol="+symbol+"&recvWindow=60000&timestamp="+(Date.now()+parseInt(env.binance_serverTimeCorrection));
        let hmacSignature = crypto.createHmac('sha256', env.binance_secret).update(dataToSign).digest('hex');

        await superagent.get(env.binance_url + "/openOrders?"+dataToSign+"&signature="+hmacSignature)
            .set({"Content-Type": "application/json", "X-MBX-APIKEY": env.binance_key})
            .timeout(15000)
            .then(async (response) => {
                resolve(response.body);
            })
            .catch(async (error) => {
                error = utils.apiErrorHandler(error, {action: "getOpenOrders", url: env.binance_url + "/openOrders?"+dataToSign+"&signature="+hmacSignature, header: {"Content-Type": "application/json", "X-MBX-APIKEY": env.binance_secret}});
                reject(error);
            })
    })
}

async function getRelativeStrengthIndex(symbol){
    return new Promise(async (resolve, reject) => {

        /*
        # RSI
        env.RSI_upperMinimum=70
        env.RSI_lowerMaximum=30
        env.RSI_interval=1m
        env.RSI_limit=1000
        env.RSI_samples=8
        */

        // get candleStick data of 1 minute interval from 30 minutes limit
        await superagent.get(env.binance_url + "/klines?symbol="+symbol+"&interval="+env.RSI_interval+"&limit="+env.RSI_limit)
            .set({"Content-Type": "application/json"})
            .timeout(15000)
            .then(async (response) => {

                // calculate average gains and losses
                let avgGainsAndLosses = [];
                for (let i = 0; i < response.body.length -1; i++){
                    avgGainsAndLosses.push(response.body[i+1][4] - response.body[i][4]);
                }

                // calculate initial RSI value
                let avgGain = 0.0;
                let avgLoss = 0.0;
                let samples = parseInt(env.RSI_samples);
                for(let j = 0; j < samples; j++){
                    if(avgGainsAndLosses[j] >= 0){
                        avgGain = avgGain + avgGainsAndLosses[j];
                    }
                    else if(avgGainsAndLosses[j] < 0){
                        avgLoss = avgLoss + (-1*avgGainsAndLosses[j]);
                    }
                }
                avgGain = avgGain/samples;
                avgLoss = avgLoss/samples;

                //smooth RSI value with next given values
                for(let k = samples; k < avgGainsAndLosses.length; k++) {
                    if(avgGainsAndLosses[k] >= 0){
                        avgGain = ( avgGain * (samples -1) + avgGainsAndLosses[k] )/samples;
                        avgLoss = ( avgLoss * (samples -1) )/samples;
                    }
                    else{
                        avgGain = ( avgGain * (samples -1) )/samples;
                        avgLoss = ( (avgLoss * (samples -1)) + (-1*avgGainsAndLosses[k]) )/samples;
                    }
                }

                let RSI = ( 100 - (100 / (1 + (avgGain/avgLoss) ) ) );
                resolve(RSI);
            })
            .catch(async (error) => {
                error = utils.apiErrorHandler(error, {action: "getAvgAssetFiatPrice", url: env.binance_url + "/klines?symbol="+symbol+"&interval="+env.RSI_interval+"&limit="+env.RSI_limit, header: {"Content-Type": "application/json"}});
                reject(error);
            })
    })
}

async function getBestSymbolToInvest(){
    return new Promise(async (resolve, reject) => {

        // query on tradingView technical analysis (https://scanner.tradingview.com/crypto/scan)
        // to find an array of symbols that accomplish...
        // 1) exchange on binance
        // 2) exchange available for main fiat
        // 3) exclude perpetual, futures, up/down(leverages)
        // 4) summary rating(1-minute interval) greater than 0.4
        // 5) summary rating(5-minute interval) greater than 0.4
        // 4) summary rating(15-minute interval) greater than 0.4
        // 4) summary rating(60-minute interval) greater than 0.4
        // 6) volatility(1-week interval) greater than 5%
        // then... get the symbol with the highest oscillatorsRating of this array
        let dataToAsk = {
            "filter": [
                    {
                        "left": "exchange",
                        "operation": "equal",
                        "right": "BINANCE"
                    },
                    {
                        "left": "name",
                        "operation": "match",
                        "right": env.trade_fiat
                    },
                    {
                        "left": "name",
                        "operation": "nmatch",
                        "right": "perp"
                    },
                    {
                        "left": "name",
                        "operation": "nmatch",
                        "right": "premium"
                    },
                    {
                        "left": "name",
                        "operation": "nmatch",
                        "right": "down"
                    },
                    {
                        "left": "name",
                        "operation": "nmatch",
                        "right": "up"
                    },
                    {
                        "left": "Recommend.All|1",
                        "operation": "greater",
                        "right": Number(env.ta_minimum_summaryRating_1min_toTrigger_BUY)
                    },
                    {
                        "left": "Recommend.All|5",
                        "operation": "greater",
                        "right": Number(env.ta_minimum_summaryRating_5min_toTrigger_BUY)
                    },
                    {
                        "left": "Recommend.All|15",
                        "operation": "greater",
                        "right": Number(env.ta_minimum_summaryRating_15min_toTrigger_BUY)
                    },
                    {
                        "left": "Recommend.All|60",
                        "operation": "greater",
                        "right": Number(env.ta_minimum_summaryRating_60min_toTrigger_BUY)
                    },
                    {
                        "left": "Volatility.W",
                        "operation": "greater",
                        "right": Number(env.ta_minimum_volatility_week_toTrigger_BUY)
                    }
                ],
                "sort": {
                    "sortBy": "Recommend.Other|1",
                    "sortOrder": "desc"
                },
                "range": [0,1]
            };
        await superagent.post(env.ta_url)
            .send(dataToAsk)
            .timeout(15000)
            .then(async (response) => {

                if(response.body.data.length > 0){
                    resolve(response.body.data[0].s.replace('BINANCE:',''));
                }
                else{
                    resolve(false);
                }
            })
            .catch(async (error) => {
                error = utils.apiErrorHandler(error, {action:"getBestSymbolToInvest", url:"https://scanner.tradingview.com/crypto/scan", header:{"Content-Type": "application/json"}, body:dataToAsk});
                reject(error);
            })
    })
}

async function elEssePatternSignal(symbol, miniDB, assetFiatPrice, telegram){
    return new Promise(async (resolve, reject) => {

        // if priceOfLastBuyOrder is not defined... place BUY order
        if(!miniDB.priceOfLastBuyOrder){
                lastPossibleSellingPrice = 0;
                lastSignal = "BUY";
                resolve("BUY");
            }

        // if profit >= minimumProfitTo_placeSellOrder
        if(miniDB.priceOfLastBuyOrder  &&
          ( ((((assetFiatPrice*100)/Number(miniDB.priceOfLastBuyOrder))-100) - Number(env.trade_exchangeFeePercentage)) >= Number(env.trade_minimumProfitTo_placeSellOrder) ) ){

                // if currentPrice >= lastPossibleSellingPrice... AWAIT
                if(assetFiatPrice >= lastPossibleSellingPrice){
                    lastPossibleSellingPrice = assetFiatPrice;

                    // if profit >= minimumProfitTo_notify... send alert over telegram
                    if( ((((assetFiatPrice*100)/Number(miniDB.priceOfLastBuyOrder))-100) - Number(env.trade_exchangeFeePercentage)) >= Number(env.trade_minimumProfitTo_notify) ){

                        let notification = ((((assetFiatPrice*100)/Number(miniDB.priceOfLastBuyOrder))-100) - Number(env.trade_exchangeFeePercentage)).toLocaleString()+" % of possible profit for exchange of "+symbol+"\n\n"+utils.getDateStamp();
                        await telegramController.sendMessage(telegram, notification, "text")
                            .catch(async (error) => {
                                await log.save(error, "error");
                            })
                            .finally( () => {
                                lastSignal =  "AWAIT";
                                resolve("AWAIT");
                            })
                    }
                    else{
                        lastSignal =  "AWAIT";
                        resolve("AWAIT");
                    }
                }

                // if currentPrice < lastPossibleSellingPrice... place SELL order
                else if(assetFiatPrice < lastPossibleSellingPrice){
                    lastPossibleSellingPrice = 0;
                    lastSignal = "SELL";
                    resolve("SELL");
                }
        }

        // if profit < minimumProfitTo_placeSellOrder
        else if(miniDB.priceOfLastBuyOrder  &&
                ( (((assetFiatPrice*100)/Number(miniDB.priceOfLastBuyOrder))-100) < Number(env.trade_minimumProfitTo_placeSellOrder) ) ){
                    lastPossibleSellingPrice = 0;
                    lastSignal =  "AWAIT";
                    resolve("AWAIT");
        }

        /*
        // get candleStick data of 1 minute interval from 30 minutes limit
        let limit = parseInt(env.elEssePattern_limit);
        await superagent.get( env.binance_url + "/klines?symbol=" + symbol + "&interval=" + env.elEssePattern_interval + "&limit=" + (limit+1) )
            .set({"Content-Type": "application/json"})
            .timeout(15000)
            .then(async (candleSticks) => {

                let uppers_last30 = [];
                let lowers_last30 = [];
                let farUpper;
                let farLower;
                let signal = "AWAIT";
                candleSticks.body = await candleSticks.body.reverse();

                // create arrays of last 30 uppers & lowers prices marks... openPrice->[1], closePrice->[4]
                for(let i = 0; i <= 29; i++){
                    if(candleSticks.body[i][closePrice]      > candleSticks.body[i][openPrice]){
                        uppers_last30.push(Number( candleSticks.body[i][closePrice] ));
                        lowers_last30.push(Number( candleSticks.body[i][openPrice]  ));
                    }
                    else if(candleSticks.body[i][closePrice] <= candleSticks.body[i][openPrice]){
                        uppers_last30.push(Number( candleSticks.body[i][openPrice]  ));
                        lowers_last30.push(Number( candleSticks.body[i][closePrice] ));
                    }
                }

                // calculate farUpper, middleUpper,  farLower, middleLower
                let middleUpper = Math.max.apply(null, uppers_last30);
                let middleLower = Math.min.apply(null, lowers_last30);
                if(candleSticks.body[limit][closePrice]     > candleSticks.body[limit][openPrice]){
                    farUpper = Number( candleSticks.body[limit][closePrice] );
                    farLower = Number( candleSticks.body[limit][openPrice] );
                }
                else if(candleSticks.body[limit][closePrice] <= candleSticks.body[limit][openPrice]){
                    farUpper = Number( candleSticks.body[limit][openPrice] );
                    farLower = Number( candleSticks.body[limit][closePrice] );
                }

                // calculate signal
                if(farUpper      > middleUpper  &&  lastSignal !== "SELL"  &&  ( (((Number(candleSticks.body[0][openPrice])*100)/Number(miniDB.priceOfLastBuyOrder))-100) > Number(env.trade_minimumProfitTo_placeSellOrder) ) ){
                    lastSignal = "SELL"
                    signal =     "SELL"
                }
                else if(farLower < middleLower  &&  lastSignal !== "BUY"){
                    lastSignal = "BUY"
                    signal =     "BUY"
                }

                resolve(signal);
                //resolve(JSON.stringify({dateStamp:utils.getDateStamp(), price:Number(candleSticks.body[30][closePrice]).toFixed(2), SIGNAL:signal, farUpper:farUpper.toFixed(2), middleUpper:middleUpper.toFixed(2), farLower:farLower.toFixed(2), middleLower:middleLower.toFixed(2)},null,4))
            })
            .catch(async (error) => {
                error = utils.apiErrorHandler(error, {
                                action: "elEssePatternSignal",
                                url: env.binance_url + "/klines?symbol=" + symbol + "&interval=" + env.elEssePattern_interval + "&limit=" + env.elEssePattern_limit,
                                header: {"Content-Type": "application/json"}});
                reject(error);
            })
        */
    })
}

module.exports = {
    getExchangeInfo,
    getLastOrder,
    getAccountBalances,
    getAssetFiatPrice,
    getOpenOrders,
    getRelativeStrengthIndex,
    getBestSymbolToInvest,
    elEssePatternSignal
};