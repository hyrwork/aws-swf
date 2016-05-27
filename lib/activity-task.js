var events = require('events')
var createClient = require('./swf').createClient;

/**
 * Class to make it easier to respond to activity tasks
 * @constructor
 * @param {Object} config - Object containing the taskToken from SWF
 * @param {Object} [swfClient]
 */
var ActivityTask = exports.ActivityTask = function (config, swfClient) {

    this.config = config;

    this.swfClient = swfClient || createClient();
};

require('util').inherits(ActivityTask, events.EventEmitter);

function stringify(str) {
    if(!str) {
        return "";
    }

    if (typeof str !== "string") {
        return JSON.stringify(str);
    }

    return str;
}

ActivityTask.prototype = {


    respondCanceled: function (details, cb){
            params ={
                "taskToken":this.config.taskToken,
                "details":details
            }
            var self = this;
            this.swfClient.respondActivityTaskCanceled(
                params,
                function (err, data){
                  self.emit('respondCanceled', params);
                    self.onDone()
                    if (cb){
                        cb(err)
                    }
                }
            )
        return task
    },
    /**
     * Sends a "RespondActivityTaskCompleted" to AWS.
     * @param {Mixed} result - Result of the activity (will get stringified in JSON if not a string)
     * @param {Function} [cb] - callback
     */
    respondCompleted: function (result, cb) {
        var self = this;
        this.swfClient.respondActivityTaskCompleted({
            result: stringify(result),
            taskToken: this.config.taskToken
        }, function (err) {
          self.emit('respondCompleted', result);
            self.onDone()
            if (cb) {
                cb(err);
            }

        });

    },


    /**
     * Sends a "RespondActivityTaskFailed" to AWS.
     * @param {String} reason
     * @param {String} details
     * @param {Function} [cb] - callback
     */
    respondFailed: function (reason, details, cb) {
        var self = this;
        var o = {
            "taskToken": this.config.taskToken
        };
        if (reason) {
            o.reason = reason;
        }
        if (details) {
            o.details = stringify(details);
        }

        this.swfClient.respondActivityTaskFailed(o, function (err) {
          self.emit('respondFailed', o);
            self.onDone()
            if (cb) {
                cb(err);
            }

        });

    },

    /**
     * Sends a heartbeat to AWS. Needed for long run activity
     * @param {Mixed} heartbeat - Details of the heartbeat (will get stringified in JSON if not a string)
     * @param {Function} [cb] - callback
     */
    recordHeartbeat: function (heartbeat, cb) {
        var self = this;
        this.swfClient.recordActivityTaskHeartbeat({
            taskToken: this.config.taskToken,
            details: stringify(heartbeat)
        }, function (err) {
          self.emit('recordHeartbeat', heartbeat);
            if (cb) {
                cb(err);
            }

        });
    }

};
