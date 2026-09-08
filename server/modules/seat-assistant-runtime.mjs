import { createSeatAssistantRepository } from './seat-assistant-repository.mjs';
import { createSeatAssistantSessionStore } from './seat-assistant-session-store.mjs';
import { createSeatAssistantProvider } from './seat-assistant-provider.mjs';
import { createSeatAssistantService } from './seat-assistant-service.mjs';
import { createSeatAssistantScheduler } from './seat-assistant-scheduler.mjs';

export function createSeatAssistantRuntime({
  sqliteRepository,
  cookieSecret,
  configuredOrigin,
  providerMode,
  areaId,
  featureEnabled,
  minimumRequestIntervalSeconds,
  queueProactiveNotification = () => {},
  logger = () => {},
} = {}) {
  const repository = createSeatAssistantRepository(sqliteRepository);
  const sessionStore = createSeatAssistantSessionStore({ repository, cookieSecret, configuredOrigin });
  const provider = createSeatAssistantProvider({ mode: providerMode, sessionStore, areaId });
  const service = createSeatAssistantService({
    repository,
    provider,
    featureEnabled,
    minimumRequestIntervalSeconds,
    queueProactiveNotification,
    logger,
  });
  const scheduler = createSeatAssistantScheduler({
    service,
    featureEnabled,
    providerEnabled: () => provider.enabled,
    logger,
  });
  return {
    seatAssistantRepository: repository,
    seatAssistantSessionStore: sessionStore,
    seatAssistantProvider: provider,
    seatAssistantService: service,
    seatAssistantScheduler: scheduler,
  };
}
