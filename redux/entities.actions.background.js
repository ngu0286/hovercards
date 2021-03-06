var createAction = require('redux-actions').createAction;

var analyticsActions   = require('./analytics.actions.background');
var browser            = require('../extension/browser');
var integrations       = require('../integrations/index.background');
var integrationsConfig = require('../integrations/config');
var entityLabel        = require('../utils/entity-label');
var report             = require('../report');

var setTabEntity = createAction('setEntity', null, function(entity, label) {
	if (!label) {
		return null;
	}
	return { label: label };
});

var setEntity = createAction('SET_ENTITY', null, function(entity, label) {
	if (!label) {
		return null;
	}
	return { label: label };
});

var loading = {};

module.exports.getEntity = function(request, meta, sender) {
	var start = Date.now();

	return function(dispatch, getState) {
		var label = entityLabel(request);
		var state = getState();

		var entity = state.entities[label];

		if (entity && entity.loaded && Date.now() - entity.loaded <= (integrationsConfig.integrations[request.api].cache_length || 5 * 60 * 1000)) {
			var newLabel = entityLabel(entity);
			if (newLabel !== label) {
				browser.tabs.sendMessage(sender.tab.id, setTabEntity(entity, label))
					.catch(report.captureException);
			}
			return Promise.resolve({ payload: entity });
		}

		if (!loading[label]) {
			loading[label] = integrations(request);

			loading[label]
				.then(function(entity) {
					delete loading[label];
					dispatch(setEntity(entity));
					var newLabel = entityLabel(entity);
					if (newLabel !== label) {
						dispatch(setEntity(entity, label));
					}
					dispatch(analyticsActions.analytics(['send', 'timing', entityLabel(entity, true), 'Loading', Date.now() - start], sender))
						.catch(report.captureException);
				})
				.catch(function(err) {
					delete loading[label];
					err.request = request;
					dispatch(setEntity(err));
					if (!err.code || err.code >= 500) {
						report.captureException(err);
					}
				});
		}

		if (sender.tab.id !== undefined) {
			loading[label]
				.then(function(entity) {
					browser.tabs.sendMessage(sender.tab.id, setTabEntity(entity))
						.catch(report.captureException);
					var newLabel = entityLabel(entity);
					if (newLabel !== label) {
						browser.tabs.sendMessage(sender.tab.id, setTabEntity(entity, label))
							.catch(report.captureException);
					}
				})
				.catch(function(err) {
					if (err.toJSON) {
						err = err.toJSON();
					}
					browser.tabs.sendMessage(sender.tab.id, { type: 'setEntity', payload: Object.assign(err, { type: 'FeathersError', request: request }), error: true })
						.catch(report.captureException);
				});
		}

		dispatch(setEntity(state.entities[label] || request));
		return Promise.resolve({ payload: state.entities[label] || request });
	};
};
