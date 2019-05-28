// This sample demonstrates handling intents from an Alexa skill using the Alexa Skills Kit SDK (v2).
// Please visit https://alexa.design/cookbook for additional examples on implementing slots, dialog management,
// session persistence, api calls, and more.
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
            speechText = 'Welcome to Lux Bus. You can try asking something like "when is the next bus leaving <lang xml:lang="fr-FR">Gare Centrale</lang>". Or, to check buses from your saved favourite stop, simply "when is the next bus". What would you like to do?';
        } else {
            speechText = 'Welcome to Lux Bus. You can try asking something like "when is the next bus leaving <lang xml:lang="fr-FR">Gare Centrale</lang>". Alternatively, you can say "save my stop" to set a favourite bus stop. What would you like to do?';
        }        
        
        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .getResponse();
    }
};

const getBus = async (busStop) => {
    try {
        const { data } = await axios.get('https://travelplanner.mobiliteit.lu/restproxy/departureBoard', {
            params: {
                accessId: 'cdt',
                format: 'json',
                filterEquiv: 0,
                id: 'A=1@O=' + busStop
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
        let busStop;
        const filledSlots = handlerInput.requestEnvelope.request.intent.slots;
        const slotValues = getSlotValues(filledSlots);
        if (slotValues.busStop.isValidated) {
            busStop = slotValues.busStop.resolved;
        } else {
            const attributesManager = handlerInput.attributesManager;
            const s3Attributes = await attributesManager.getPersistentAttributes() || {};
            busStop = s3Attributes.hasOwnProperty('faveStop')? s3Attributes.faveStop : 'Luxembourg, Gare Centrale' ;
        }
          
        try {            
            const buses = await getBus(busStop);
            var speechText;
            if (buses.Departure === null) {
                speechText = `Sorry, I couldn't find any buses for ${busStop}`;
            } else {   
                const bus = buses.Departure[0];
                const busName = bus.name.trim().replace('Bus','bus');
                var busDue = bus.rtDate ? bus.rtDate + ' ' + bus.rtTime : bus.date + ' ' + bus.time;
                busDue = moment.tz(busDue, 'Europe/Luxembourg');
                var timeRemaining;
                if (busDue.diff(moment(), 'seconds') < 1) {
                    timeRemaining = 'now'
                } else {
                    timeRemaining = busDue.fromNow();
                }
                speechText = `The ${busName} to ${bus.direction} is leaving ${timeRemaining} from ${bus.stop}`;
            }            
            return handlerInput.responseBuilder
                .speak(speechText)
                .getResponse();
        } catch (error) {
          console.error(error);
        }
    },
};

const SaveStopIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'SaveStopIntent';
    },
    async handle(handlerInput) {
        const attributesManager = handlerInput.attributesManager;
        let s3Attributes = {"faveStop":handlerInput.requestEnvelope.request.intent.slots.busStop.resolutions.resolutionsPerAuthority.values[0].value.name};
        attributesManager.setPersistentAttributes(s3Attributes);
        await attributesManager.savePersistentAttributes();

        let speechText = 'Saved';

        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
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
        SaveStopIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler) // make sure IntentReflectorHandler is last so it doesn't override your custom intent handlers
    .addErrorHandlers(
        ErrorHandler)
    .withPersistenceAdapter(
        new persistenceAdapter.S3PersistenceAdapter({bucketName:process.env.S3_PERSISTENCE_BUCKET}))
    .lambda();
