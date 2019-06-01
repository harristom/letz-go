const Alexa = require('ask-sdk-core');
const persistenceAdapter = require('ask-sdk-s3-persistence-adapter');
const axios = require('axios');
const moment = require('moment-timezone');

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
    },
    async handle(handlerInput) {        
        const attributesManager = handlerInput.attributesManager;
        const s3Attributes = await attributesManager.getPersistentAttributes() || {};
        let speechText;
        if (s3Attributes.hasOwnProperty('faveStop')) {
            speechText = 'Welcome to Lux Bus. You can try asking something like "when is the next bus leaving Charlys Gare". Or, to check buses from your saved favourite stop, just say "when is the next bus". What would you like to do?';
        } else {
            speechText = 'Welcome to Lux Bus. You can try asking something like "when is the next bus leaving Charlys Gare". Alternatively, you can say "save my stop" to set a favourite bus stop. What would you like to do?';
        }        
        
        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .getResponse();
    }
};

const getBus = async (fromStop, toStop) => {
    if (fromStop) fromStop = 'A=1@O=' + fromStop;
    if(toStop) toStop = 'A=1@O=' + toStop;
    try {
        const { data } = await axios.get('https://travelplanner.mobiliteit.lu/restproxy/departureBoard', {
            params: {
                accessId: 'cdt',
                format: 'json',
                filterEquiv: 0,
                id: fromStop,
                direction: toStop,
                duration: 1439,
                maxJourneys: 1
            }
        });
        return data;
    } catch (error) {
        console.error('cannot fetch departure board', error);
    }
};

const NextBusIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'NextBusIntent';
    },
    async handle(handlerInput) {
        let fromStop;
        const filledSlots = handlerInput.requestEnvelope.request.intent.slots;
        const slotValues = getSlotValues(filledSlots);
        if (slotValues.fromStop.isValidated) {
            fromStop = slotValues.fromStop.resolved;
        } else {
            const attributesManager = handlerInput.attributesManager;
            const s3Attributes = await attributesManager.getPersistentAttributes() || {};
            fromStop = s3Attributes.hasOwnProperty('faveStop')? s3Attributes.faveStop : 'Luxembourg, Gare Centrale' ;
        }
        let toStop;
        let busNumber;
        if (slotValues.toStop.isValidated) toStop = slotValues.toStop.resolved;
        if (filledSlots.busNumber.value) busNumber = filledSlots.busNumber.value;
        try {
            const buses = await getBus(fromStop, toStop);
            console.log('Buses before filter: ', buses);
            if (busNumber && buses.hasOwnProperty('Departure')) {
                buses.Departure = buses.Departure.filter(d => d.Product.line == busNumber);
            }
            console.log('Buses after filter: ', buses);
            let speechText = '';
            if (buses.hasOwnProperty('Departure') && buses.Departure.length > 0) {
                console.log('Found departures');
                const bus = buses.Departure[0];
                const busName = bus.name.trim().replace('Bus','bus');
                var busDue = bus.rtDate ? bus.rtDate + ' ' + bus.rtTime : bus.date + ' ' + bus.time;
                busDue = moment.tz(busDue, 'Europe/Luxembourg');
                var timeRemaining;
                if (busDue.diff(moment(), 'seconds') < 1) {
                    timeRemaining = 'now';
                } else {
                    timeRemaining = busDue.fromNow();
                }
                if (slotValues.toStop.value && !slotValues.toStop.isValidated) {
                    speechText = 'Sorry, I couldn\'t recognise your destination. ';
                }
                speechText += `The ${busName} to ${bus.direction} is leaving ${timeRemaining} from ${bus.stop}`;
            } else {
                console.log('No departures');
                speechText = `Sorry, I couldn't find any `;
                if (busNumber) speechText+= `number ${busNumber} `;
                speechText += 'buses ';
                if (toStop) speechText += `to ${toStop} `;
                speechText += `from ${fromStop}`;
            }            
            return handlerInput.responseBuilder
                .speak(speechText)
                .getResponse();
        } catch (error) {
          console.error(error);
        }
    },
};

const DeleteStopHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'DeleteStopIntent';
    },
    async handle(handlerInput) {
        const attributesManager = handlerInput.attributesManager;
        await attributesManager.deletePersistentAttributes();
        const speechText = 'Ok, I deleted your saved stop'
        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .getResponse();
    }
};


const SaveStopInProgressHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'SaveStopIntent'
            && handlerInput.requestEnvelope.request.dialogState !== 'COMPLETED';
    },
    handle(handlerInput) {
        const currentIntent = handlerInput.requestEnvelope.request.intent;
        return handlerInput.responseBuilder
            .addDelegateDirective(currentIntent)
            .getResponse();
    }
};

const SaveStopSlotConfirmationHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'SaveStopIntent'
            && handlerInput.requestEnvelope.request.dialogState !== 'COMPLETED'
            && getSlotValues(handlerInput.requestEnvelope.request.intent.slots).busStop.isValidated
            && handlerInput.requestEnvelope.request.intent.slots.busStop.confirmationStatus === 'NONE';
    },
    handle(handlerInput) {
        const filledSlots = handlerInput.requestEnvelope.request.intent.slots;
        const slotValues = getSlotValues(filledSlots);
        const busStop = slotValues.busStop;        
        const speechText = `I found ${busStop.resolved}. Is that right?`;
        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .addConfirmSlotDirective("busStop")
            .getResponse();
    }
};

const SaveStopCompleteHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'SaveStopIntent'
            && handlerInput.requestEnvelope.request.dialogState === 'COMPLETED';
    },
    async handle(handlerInput) {
        const filledSlots = handlerInput.requestEnvelope.request.intent.slots;
        const slotValues = getSlotValues(filledSlots);
        const attributesManager = handlerInput.attributesManager;
        let s3Attributes = {"faveStop":slotValues.busStop.resolved};
        attributesManager.setPersistentAttributes(s3Attributes);
        await attributesManager.savePersistentAttributes();

    let speechText = `Thanks, I'll remember that. Next time you ask "when is the next bus" I'll assume you're asking about buses from this stop. You can still ask about buses from other stops by saying something like "when is the next bus from Charlys Gare".`;

        return handlerInput.responseBuilder
            .speak(speechText)
            .getResponse();
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speechText = 'You can ask for the next bus by saying "when is the next bus". Give it a try.';

        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent'
                || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        const speechText = 'Goodbye!';
        return handlerInput.responseBuilder
            .speak(speechText)
            .getResponse();
    }
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        // Any cleanup logic goes here.
        return handlerInput.responseBuilder.getResponse();
    }
};

// The intent reflector is used for interaction model testing and debugging.
// It will simply repeat the intent the user said. You can create custom handlers
// for your intents by defining them above, then also adding them to the request
// handler chain below.
const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = handlerInput.requestEnvelope.request.intent.name;
        const speechText = `You just triggered ${intentName}`;

        return handlerInput.responseBuilder
            .speak(speechText)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};

// Generic error handling to capture any syntax or routing errors. If you receive an error
// stating the request handler chain is not found, you have not implemented a handler for
// the intent being invoked or included it in the skill builder below.
const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`~~~~ Error handled: ${error.message}`);
        const speechText = `Sorry, I couldn't understand what you said. Please try again.`;

        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .getResponse();
    }
};

function getSlotValues(filledSlots) {
  const slotValues = {};

  console.log(`The filled slots: ${JSON.stringify(filledSlots)}`);
  Object.keys(filledSlots).forEach((item) => {
    const name = filledSlots[item].name;

    if (filledSlots[item] &&
      filledSlots[item].resolutions &&
      filledSlots[item].resolutions.resolutionsPerAuthority[0] &&
      filledSlots[item].resolutions.resolutionsPerAuthority[0].status &&
      filledSlots[item].resolutions.resolutionsPerAuthority[0].status.code) {
      switch (filledSlots[item].resolutions.resolutionsPerAuthority[0].status.code) {
        case 'ER_SUCCESS_MATCH':
          slotValues[name] = {
            synonym: filledSlots[item].value,
            resolved: filledSlots[item].resolutions.resolutionsPerAuthority[0].values[0].value.name,
            isValidated: true,
          };
          break;
        case 'ER_SUCCESS_NO_MATCH':
          slotValues[name] = {
            synonym: filledSlots[item].value,
            resolved: filledSlots[item].value,
            isValidated: false,
          };
          break;
        default:
          break;
      }
    } else {
      slotValues[name] = {
        synonym: filledSlots[item].value,
        resolved: filledSlots[item].value,
        isValidated: false,
      };
    }
  }, this);

  return slotValues;
}

// This handler acts as the entry point for your skill, routing all request and response
// payloads to the handlers above. Make sure any new handlers or interceptors you've
// defined are included below. The order matters - they're processed top to bottom.
exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        NextBusIntentHandler,
        SaveStopCompleteHandler,
        SaveStopSlotConfirmationHandler,
        SaveStopInProgressHandler,
        DeleteStopHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler) // make sure IntentReflectorHandler is last so it doesn't override your custom intent handlers
    .addErrorHandlers(
        ErrorHandler)
    .withPersistenceAdapter(
        new persistenceAdapter.S3PersistenceAdapter({bucketName:process.env.S3_PERSISTENCE_BUCKET}))
    .lambda();
