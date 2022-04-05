/**
 * sleep: sleep a certain amount of seconds
 * @returns {promise<void>}
 */
function sleep(seconds){
    return new Promise(resolve => setTimeout(resolve, seconds*1000))
}

/**
 * getDateStamp: get dateStamp
 * @returns {String}
 */
function getDateStamp(){
    return createDateStamp(new Date());
}

/**
 * getTimeStamp: get timeStamp in 10 character format
 * @returns {number}
 */
function getTimeStamp(){
    return Math.floor(new Date()/1000);
}

/**
 * getDateStamp: get dateStamp in format like 31-12-2021_23:59:59, from timeStamp in 10 character format
 * @returns {String}
 */
function getDateStampFromTimeStamp(timeStamp){
    return createDateStamp((timeStamp.toString().length === 10) ? new Date(timeStamp*1000) : new Date(timeStamp));
}

/**
 * createDateStamp: create dateStamp in format like 31-12-2021_23:59:59
 * @returns {String}
 */
function createDateStamp(dateObject){
    return ("0" +  dateObject.getDate()).    slice(-2) + "-" +
           ("0" + (dateObject.getMonth()+1)).slice(-2) + "-" +
                   dateObject.getFullYear()            + "_" +
           ("0" +  dateObject.getHours()).   slice(-2) + ":" +
           ("0" +  dateObject.getMinutes()). slice(-2) + ":" +
           ("0" +  dateObject.getSeconds()). slice(-2);
}

/**
 * errorHandler: Handles errors on api request
 * @param error
 * @param data
 */
function apiErrorHandler(error, data){

    if(!(error.hasOwnProperty('response')  &&  error.response  &&  error.response.hasOwnProperty('body')  &&  error.response.body)){
        if(error.hasOwnProperty('message')  &&  error.message){
            error = error.message;
        }
        else{
            error = "(error.response not found and/or error.response.body not found), and error.message not found";
        }
    }

    let errorHandled = {data:         data,
                        errorMessage: ((error.hasOwnProperty('response')  &&  error.response  &&  error.response.hasOwnProperty('statusCode')  &&  error.response.statusCode) ? ("http status code: "+error.response.statusCode+"\n") : "")  + ((error.hasOwnProperty("response")  &&  error.response.hasOwnProperty("body")  &&  error.response.body.hasOwnProperty("msg")) ? error.message+" -> "+error.response.body.msg : ((error.hasOwnProperty('stack') ? error.stack : error))),
                        from:         "utils -> apiErrorHandler"}

    if((error.hasOwnProperty('response')             &&  error.response              &&
        error.response.hasOwnProperty('statusCode')  &&  error.response.statusCode)  ){
            errorHandled.statusCode = error.response.statusCode;
    }
    return errorHandled;
}

module.exports = {
    sleep,
    getDateStamp,
    getTimeStamp,
    getDateStampFromTimeStamp,
    apiErrorHandler
};