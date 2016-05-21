var _ = require('lodash');

/**
 * Methods to query the EventList of DecisionTasks about the state of the workflow execution
 * @constructor
 */
var EventList = exports.EventList = function (events) {
   this._events = this._formatEventAttributes(events);
};


EventList.prototype = {

  /**
   * Each event object has a different name for its ___Attributes property. This normalizes those.
   * @private
   */
  _formatEventAttributes: function(events){
    return _(events)
      .chain()
      .map(function(event){

        var eventAttributesKey = _(Object.keys(event))
          .chain()
          .without('eventTimestamp', 'eventType', 'eventId')
          .value();

        eventAttributesKey = eventAttributesKey[0];

        event.eventAttributes = _.extend({
          key: eventAttributesKey
        }, event[eventAttributesKey]);


        return event;

      })
      .value();
  },

  /**
   * *************************************************************************
   * new aws-swf methods:
   * *************************************************************************
   */
  hasEventType: function(eventType){
    return _.find(this._events, {eventType: eventType}) ? true : false;
  },

  /**
   * Return the # of events completed
   * @param eventType
   * @returns {Number}
   */
  eventTypeCount: function(eventType){
    return _.filter(this._events, {eventType: eventType}).length;
  },

  /**
   * Merges the values of each ActivityTaskCompleted event
   */
  mergeActivityResults: function(){
    return _(this._events)
      .chain()
      .filter({eventType: 'ActivityTaskCompleted'})
      .map(function(event){
        var attrs = event['activityTaskCompletedEventAttributes'];
        return JSON.parse(attrs.result || '{}');
      })
      .reduce(function(result, value, key){
        return _.extend(result, value);
      })
      .value();
  },

  /**
   * Merges the values of each ChildWorkflowExecutionCompleted event of the specified activityTypeName
   * @param activityTypeName
   * @returns {*}
   */
  mergeChildWorkflowResults: function(activityTypeName){
    return _(this._events)
      .chain()
      .filter({eventType: 'ChildWorkflowExecutionCompleted'})
      .filter(function(event){
        return event.childWorkflowExecutionCompletedEventAttributes.workflowType.name === activityTypeName;
      })
      .map(function(event){
        var attrs = event.childWorkflowExecutionCompletedEventAttributes;
        return JSON.parse(attrs.result || '{}');
      })
      .value();
  },

  /**
   * Checks for completed activityTasks of the given name and returns an array of results
   * @param name
   */
  getCompletedActivityTasks: function(name){

    //Get all ActivityTaskScheduled events with the given activityType name
    var scheduled = _(this._events)
      .chain()
      .filter({eventType: 'ActivityTaskScheduled'})
      .filter(function(event){
        return event.activityTaskScheduledEventAttributes.activityType.name === name;
      })
      .map(function(event){
        return {
          eventType: event.eventType,
          activityTypeName: event.activityTaskScheduledEventAttributes.activityType.name,
          eventId: event.eventId
        };
      })
      .value();

    //Now get the eventIds to check for
    var scheduledEventIds = _(scheduled)
      .chain()
      .map(function(event){
        return event.eventId;
      })
      .value();

    //Now get the ActivityTypeCompleted events with these scheduledEventIds
    var completed = _(this._events)
      .chain()
      .filter({eventType: 'ActivityTaskCompleted'})
      .filter(function(event){
        return scheduledEventIds.indexOf(event.activityTaskCompletedEventAttributes.scheduledEventId) > -1;
      })
      .map(function(event){
        return JSON.parse(event.activityTaskCompletedEventAttributes.result);
      })
      .value();

    //Return
    return completed;

  },

  /**
   * Gets eventIds for tasks that start a new process, used to find subsequent references to them
   * @param eventType
   * @private
   */
  _getInitiatingEventIds: function(eventType){
    var result = null;

    //Get all ActivityTaskScheduled events with the given activityType name
    result = _(this._events)
      .chain()
      .filter({eventType: eventType})
      .map(function(event){
        return event.eventId;
      })
      .value();

    //Now get the eventIds to check for
    var scheduledEventIds = _(result)
      .chain()
      .map(function(event){
        return event.eventId;
      })
      .value();


    //Return
    return result;

  },

  /**
   * Checks for ChildWorkflow events and returns a summary of attempts, completions, and failures
   */
  getChildWorkflowSummary: function(){
    var result = null;

    //Get the eventIds to check for
    var initiatingEventIds = this._getInitiatingEventIds('StartChildWorkflowExecutionInitiated');

    //Get related events
    //Now get all events referencing these scheduledEventIds
    result = _(this._events)
      .chain()
      .filter(function(event){
        return initiatingEventIds.indexOf(event.eventAttributes.initiatedEventId) > -1
      })
      .map(function(event){
        delete event[event.eventAttributes.key];
        return event;

      })
      .value()

    //Create a summary
    var summary = {
      scheduled: initiatingEventIds.length,
      started: 0,
      canceled: 0,
      completed: 0,
      failed: 0
    };

    //For each of the related events,
    result.forEach(function(event){
      switch(event.eventType){
        case 'ChildWorkflowExecutionStarted':
          summary.started++;
          break;
        case 'ChildWorkflowExecutionCompleted':
          summary.completed++;
          break;
        case 'ChildWorkflowExecutionTimedOut':
          summary.failed++;
          break;
        default:
          console.error('getChildWorkflowSummary unhandled event.eventType "' + event.eventType + '"');
          //throw new Error('getChildWorkflowSummary unhandled event.eventType "' + event.eventType + '"');
      }
    });

    //Add 'pending' and 'resolved' properties
    summary.resolved = (summary.completed + summary.canceled + summary.failed);
    summary.pending = (summary.scheduled - summary.resolved);


    result = summary;

    //Return
    return result;

  },

  /**
   * Checks for activityTasks by name and returns a summary of attempts, completions and failures
   * @param name
   */
  getActivityTaskSummary: function(name){
    var result = null;

    //Get the eventIds to check for
    var initiatingEventIds = this._getInitiatingEventIds('ActivityTaskScheduled');
    
    //Now get all events referencing these scheduledEventIds
    result = _(this._events)
      .chain()
      .filter(function(event){
        return initiatingEventIds.indexOf(event.eventAttributes.scheduledEventId) > -1
      })
      .value()

    //Create a summary
    var summary = {
      scheduled: initiatingEventIds.length,
      started: 0,
      canceled: 0,
      completed: 0,
      failed: 0
    };

    //For each of the related events,
    result.forEach(function(event){
      switch(event.eventType){
        case 'ActivityTaskStarted':
          summary.started++;
          break;
        case 'ActivityTaskTimedOut':
          summary.failed++;
          break;
        case 'ActivityTaskCompleted':
          summary.completed++;
          break;
        default:
          console.error('getActivityTaskSummary unhandled event.eventType "' + event.eventType + '"')
          //throw new Error('getActivityTaskSummary unhandled event.eventType "' + event.eventType + '"');
      }
    });

    //Add 'pending' and 'resolved' properties
    summary.resolved = (summary.completed + summary.canceled + summary.failed);
    summary.pending = (summary.scheduled - summary.resolved);


    result = summary;

    //Return
    return result;

  },

  /**
   * *************************************************************************
   * original aws-swf methods:
   * *************************************************************************
   */

  /**
    * Return the activityId given the scheduledEventId
    * @param {String} scheduledEventId
    * @returns {String} activityId - The activityId if found, false otherwise
    */
   activityIdFor: function (scheduledEventId) {
      var i;
      for (i = 0; i < this._events.length; i++) {
         var evt = this._events[i];
         if (evt.eventId === scheduledEventId) {
            return evt.activityTaskScheduledEventAttributes.activityId;
         }
      }
      return false;
   },

   /**
    * Return the activityId
    * @param {Integer} eventId
    * @returns {Object} evt - The event if found, false otherwise
    */
   eventById: function (eventId) {
      var i;
      for (i = 0; i < this._events.length; i++) {
         var evt = this._events[i];
         if (evt.eventId === eventId) {
            return evt;
         }
      }
      return false;
   },

  /**
   * Return the key of event attributes for the given event type
   * @param {String} eventType
   * @returns {String} attributesKey
   */
  _event_attributes_key: function(eventType) {
    return eventType.substr(0, 1).toLowerCase() + eventType.substr(1) + 'EventAttributes';
  },

  /**
   * Return the Event for the given type that has the given attribute value
   * @param {String} eventType
   * @param {String} eventAttributesKey
   * @param {String} attributeValue
   * @returns {Object} evt - The event if found, null otherwise
   */
  _event_find: function(eventType, eventAttributesKey, attributeValue) {
    var attrsKey = this._event_attributes_key(eventType);
    for(var i = 0; i < this._events.length ; i++) {
      var evt = this._events[i];
      if ( (evt.eventType === eventType) && (evt[attrsKey][eventAttributesKey] === attributeValue) ) {
        return evt;
      }
    }
    return null;
  },

  /**
   * Check the presence of an Event with the specified
   * @param {String} eventAttributesKey
   * @param {String} attributeValue
   * @param {String} eventType
   * @returns {Boolean}
   */
  _has_event_with_attribute_value: function(eventAttributesKey, attributeValue, eventType) {
    return !!this._event_find(eventType, eventAttributesKey, attributeValue);
  },

   /**
    * This method returns true if the eventType already occured for the given activityId
    * @param {String} activityId
    * @param {String} eventType
    * @returns {Boolean}
    */
   _has_eventType_for_activityId: function (activityId, eventType) {
      return this._has_event_with_attribute_value('activityId', activityId, eventType);
   },


   /**
    * Search for an event with the corresponding type that matches the scheduled activityId
    * @param {String} eventType
    * @param {String} activityId
    * @returns {Boolean}
    */
   _has_event_for_scheduledEventId: function(eventType, activityId) {
      var attrsKey = this._event_attributes_key(eventType);
      return this._events.some(function (evt) {
          if (evt.eventType === eventType) {
             if (this.activityIdFor(evt[attrsKey].scheduledEventId) === activityId) {
                return true;
             }
          }
       }, this);
   },

   /**
    * Return true if the timer with the given timerId has an event with the given eventType
    * @param {String} timerId
    * @param {String} eventType
    * @returns {Boolean}
    */
   has_timer_event: function (timerId, eventType) {
      return this._has_event_with_attribute_value('timerId', timerId, eventType);
    },

   /**
    * Return true if the timer has been canceled
    * @param {String} timerId
    * @returns {Boolean}
    */
   timer_canceled: function (timerId) {
      return this.has_timer_event(timerId, 'TimerCanceled');
   },

   /**
    * Return true if the timer has been canceled
    * @param {String} timerId
    * @returns {Boolean}
    */
   timer_fired: function (timerId) {
      return this.has_timer_event(timerId, 'TimerFired');
   },

   /**
    * Return true if the timer has been started
    * @param {String} timerId
    * @returns {Boolean}
    */
   timer_scheduled: function (timerId) {
      return this.has_timer_event(timerId, 'TimerStarted');
   },


   /**
    * lookup for StartChildWorkflowExecutionInitiated
    * @param {String} control
    * @returns {Boolean}
    */
   childworkflow_scheduled: function(control) {
      return this._events.some(function (evt) {
         if (evt.eventType === "StartChildWorkflowExecutionInitiated") {
            if (evt.startChildWorkflowExecutionInitiatedEventAttributes.control === control) {
               return true;
            }
         }
      });
   },

   /**
    * Return true if the child workflow is completed
    * @param {String} control
    * @returns {Boolean}
    */
   childworkflow_completed: function(control) {
      return this._events.some(function (evt) {
         if (evt.eventType === "ChildWorkflowExecutionCompleted") {
            var initiatedEventId = evt.childWorkflowExecutionCompletedEventAttributes.initiatedEventId;
            var initiatedEvent = this.eventById(initiatedEventId);

            if (initiatedEvent.startChildWorkflowExecutionInitiatedEventAttributes.control === control) {
               return true;
            }
         }
      }, this);
   },

   /**
    * Return true if the child workflow has failed
    * @param {String} control
    * @returns {Boolean}
    */
   childworkflow_failed: function(control) {
      var initiatedEventId, initiatedEvent;
      return this._events.some(function (evt) {
         if (evt.eventType === "StartChildWorkflowExecutionFailed") {
            initiatedEventId = evt.startChildWorkflowExecutionFailedEventAttributes.initiatedEventId;
            initiatedEvent = this.eventById(initiatedEventId);
            if (initiatedEvent.startChildWorkflowExecutionInitiatedEventAttributes.control === control) {
               return true;
            }
         } else if (evt.eventType === "ChildWorkflowExecutionFailed") {
            initiatedEventId = evt.childWorkflowExecutionFailedEventAttributes.initiatedEventId;
            initiatedEvent = this.eventById(initiatedEventId);
            if (initiatedEvent.startChildWorkflowExecutionInitiatedEventAttributes.control === control) {
               return true;
            }
         }
      }, this);
   },

   /**
    * returns true if the activityId started
    * @param {String} activityId
    * @returns {Boolean}
    */
   is_activity_started: function (activityId) {
      return this._has_eventType_for_activityId(activityId, "ActivityTaskStarted");
   },

   /**
    * returns true if the activityId has timed out
    * @param {String} activityId
    * @returns {Boolean}
    */
   has_activity_timedout: function (activityId) {
      return this._has_event_for_scheduledEventId('ActivityTaskTimedOut', activityId);
   },

   /**
    * returns true if the activityId has failed
    * @param {String} activityId
    * @returns {Boolean}
    */
   has_activity_failed: function (activityId) {
      return this._has_event_for_scheduledEventId('ActivityTaskFailed', activityId);
   },

   /**
    * Check if one of the ScheduleActivityTask failed
    * @param {String} activityId
    * @returns {Boolean}
    */
   has_schedule_activity_task_failed: function (activityId) {
      return this._has_event_for_scheduledEventId('ScheduleActivityTaskFailed', activityId);
   },


   /**
    * Returns true if the arguments failed
    * @param {String} activityId
    * @returns {Boolean}
    */
   failed: function (activityId) {
      return this.has_activity_failed(activityId) ||
             this.has_schedule_activity_task_failed(activityId);
   },

   /**
    * Returns true if the activityId timed out
    * @param {String} activityId
    * @returns {Boolean}
    */
   timed_out: function (activityId) {
      return this.has_activity_timedout(activityId);
   },

   /**
    * Returns true if the signal has arrived
    * @param {String} signalName
    * @returns {Boolean}
    */
   signal_arrived: function (signalName) {
      return this._has_event_with_attribute_value('signalName', signalName, 'WorkflowExecutionSignaled')
    },

    /**
    * Returns the signal input or null if the signal is not found or doesn't have JSON input
    * @param {String} signalName
    * @returns {Mixed}
    */
   signal_input: function (signalName) {

      var evt = this._event_find('WorkflowExecutionSignaled', 'signalName', signalName);
      if(!evt) {
        return null;
      }

      var signalInput = evt.workflowExecutionSignaledEventAttributes.input;
      try {
        var d = JSON.parse(signalInput);
        return d;
      } catch (ex) {
        return signalInput;
      }
   },


   /**
    * returns true if the activityId is canceled
    * @param {String} activityId
    * @returns {Boolean}
    */
   is_activity_canceled: function (activityId) {
      return this._has_eventType_for_activityId(activityId, "ActivityTaskCanceled");
   },

   /**
    * returns true if the activityId is scheduled
    * @param {String} activityId
    * @returns {Boolean}
    */
   is_activity_scheduled: function (activityId) {
      return this._has_eventType_for_activityId(activityId, "ActivityTaskScheduled");
   },


   /**
    * Return true if the arguments are all scheduled
    * @param {String} [...]
    * @returns {Boolean}
    */
   scheduled: function () {
      var i;
      for (i = 0; i < arguments.length; i++) {
         if (!this.is_activity_scheduled(arguments[i])) {
            return false;
         }
      }
      return true;
   },

   /**
    * returns true if no Activity has been scheduled yet...
    * @returns {Boolean}
    */
   has_workflow_just_started: function () {
      var i;
      for (i = 0; i < this._events.length; i++) {
         var evt = this._events[i];
         var evtType = evt.eventType;
         if (evtType === "ActivityTaskScheduled") {
            return false;
         }
      }
      return true;
   },

   /**
    * alias for has_workflow_just_started
    * @returns {Boolean}
    */
   just_started: function () {
      return this.has_workflow_just_started();
   },

   /**
    * returns true if we have a Completed event for the given activityId
    * @param {String} activityId
    * @returns {Boolean}
    */
   has_activity_completed: function (activityId) {
      return this._has_event_for_scheduledEventId('ActivityTaskCompleted', activityId);
   },

   /**
    * Return true if all the arguments are completed
    * @param {String} [...]
    * @returns {Boolean}
    */
   completed: function () {
      var i;
      for (i = 0; i < arguments.length; i++) {
         if ( ! (this.has_activity_completed(arguments[i]) || this.childworkflow_completed(arguments[i])  || this.timer_fired(arguments[i]) ) ) {
            return false;
         }
      }
      return true;
   },

   /**
    * Get the input parameters of the workflow
    * @returns {Mixed}
    */
   workflow_input: function () {

      var wfInput = this._events[0].workflowExecutionStartedEventAttributes.input;

      try {
         var d = JSON.parse(wfInput);
         return d;
      } catch (ex) {
         return wfInput;
      }
   },


   /**
    * Get the results for the given activityId
    * @param {String} activityId
    * @returns {Mixed}
    */
   results: function (activityId) {
      var i;
      for (i = 0; i < this._events.length; i++) {
         var evt = this._events[i];

         if (evt.eventType === "ActivityTaskCompleted") {
            if (this.activityIdFor(evt.activityTaskCompletedEventAttributes.scheduledEventId) === activityId) {

               var result = evt.activityTaskCompletedEventAttributes.result;

               try {
                  var d = JSON.parse(result);
                  return d;
               } catch (ex) {
                  return result;
               }

            }
         }
      }

      return null;
   },


   /**
    * Get the results of a completed child workflow
    * @param {String} control
    * @returns {Mixed}
    */
   childworkflow_results: function(control) {

      var i;
      for (i = 0; i < this._events.length; i++) {
         var evt = this._events[i];

         if (evt.eventType === "ChildWorkflowExecutionCompleted") {

            var initiatedEventId = evt.childWorkflowExecutionCompletedEventAttributes.initiatedEventId;
            var initiatedEvent = this.eventById(initiatedEventId);

            if (initiatedEvent.startChildWorkflowExecutionInitiatedEventAttributes.control === control) {

               var result = evt.childWorkflowExecutionCompletedEventAttributes.result;

               try {
                  result = JSON.parse(result);
               }
               catch(ex) {}

               return result;
            }
         }
      }

      return null;
   },

   /**
    * Get the details of the last marker with the given name
    * @param {String} markerName
    * @returns {Mixed}
    */
   get_last_marker_details: function (markerName) {
      var i, finalDetail;
      var lastEventId = 0;
      for (i = 0; i < this._events.length; i++) {
         var evt = this._events[i];

         if ((evt.eventType === 'MarkerRecorded') && (evt.markerRecordedEventAttributes.markerName === markerName) && (parseInt(evt.eventId, 10) > lastEventId)) {
            finalDetail = evt.markerRecordedEventAttributes.details;
            lastEventId = evt.eventId;
         }
      }
      return finalDetail;
   },

   /**
    * Get the raw event history
    * @returns {Array}
    */
   get_history: function () {
      return this._events;
   }



};

