const ReplayZoneProvider = require('./providers/ReplayZoneProvider');
const { createContainer, asClass, asValue, InjectionMode } = require('awilix');

const CacheService = require('./services/CacheService');
const CircuitBreakerService = require('./services/CircuitBreakerService');
const CronService = require('./services/CronService');
const M3U8ParserService = require('./services/M3U8ParserService');
const MatchAggregator = require('./services/MatchAggregator');
const StreamScoringService = require('./services/StreamScoringService');
const TimStreamsProvider = require('./providers/TimStreamsProvider');

const WatchFootyProvider = require('./providers/WatchFootyProvider');
const CdnLiveProvider = require('./providers/CdnLiveProvider');
const StreamSports99Provider = require('./providers/StreamSports99Provider');
const StreamicProvider = require('./providers/StreamicProvider');
const EmbedIndiaProvider = require('./providers/EmbedIndiaProvider');
const EmbedStProvider = require('./providers/EmbedStProvider');
const StreamedPkProvider = require('./providers/StreamedPkProvider');

// Fork-only providers (not present upstream).
const StreamFreeProvider = require('./providers/StreamFreeProvider');
const PpvProvider = require('./providers/PpvProvider');
const NtvProvider = require('./providers/NtvProvider');
const SportsindxProvider = require('./providers/SportsindxProvider');
const SportyHunterProvider = require('./providers/SportyHunterProvider');
const EmbedResolver = require('./services/EmbedResolver');
const SourceHealth = require('./services/SourceHealth');
const HlsGateway = require('./services/HlsGateway');

const YamlProviderBuilder = require('./services/YamlProviderBuilder');
const StreamResolveCache = require('./services/StreamResolveCache');

const container = createContainer({
  injectionMode: InjectionMode.PROXY
});

// Register Core Services
container.register({
  replayzoneProvider: asClass(ReplayZoneProvider).singleton(),
    cacheService: asClass(CacheService).singleton(),
  circuitBreaker: asClass(CircuitBreakerService).singleton(),
  m3u8Parser: asClass(M3U8ParserService).singleton(),
  cronService: asClass(CronService).singleton(),
  matchAggregator: asClass(MatchAggregator).singleton(),
  streamScorer: asClass(StreamScoringService).singleton(),
  streamResolveCache: asValue(new StreamResolveCache()),
  sourceHealth: asClass(SourceHealth).singleton(),
  hlsGateway: asClass(HlsGateway).singleton()
});

// Build dynamic YAML Providers
const yamlBuilder = new YamlProviderBuilder();
const yamlProviders = yamlBuilder.buildProviders(container, container.resolve('circuitBreaker'));

// Register Providers
container.register({
  timStreamsProvider: asClass(TimStreamsProvider).singleton(),

  watchFootyProvider: asClass(WatchFootyProvider).singleton(),
  cdnLiveProvider: asClass(CdnLiveProvider).singleton(),
  streamSports99Provider: asClass(StreamSports99Provider).singleton(),
  streamicProvider: asClass(StreamicProvider).singleton(),
  embedIndiaProvider: asClass(EmbedIndiaProvider).singleton(),
  embedStProvider: asClass(EmbedStProvider).singleton(),
  streamedPkProvider: asClass(StreamedPkProvider).singleton(),

  // Fork-only providers.
  embedResolver: asClass(EmbedResolver).singleton(),
  streamFreeProvider: asClass(StreamFreeProvider).singleton(),
  ppvProvider: asClass(PpvProvider).singleton(),
  ntvProvider: asClass(NtvProvider).singleton(),
  sportsindxProvider: asClass(SportsindxProvider).singleton(),
  sportyHunterProvider: asClass(SportyHunterProvider).singleton(),

  yamlProviders: asValue(yamlProviders)
});

module.exports = container;
