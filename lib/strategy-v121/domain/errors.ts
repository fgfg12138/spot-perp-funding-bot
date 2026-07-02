export class StrategyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly severity: "warning" | "error" | "critical"
  ) {
    super(message);
    this.name = "StrategyError";
  }
}

export class FreezeError extends StrategyError {
  constructor(message: string, public readonly freezeLevel: "level1" | "level2") {
    super(message, "FREEZE", "critical");
    this.name = "FreezeError";
  }
}

export class DataStaleError extends StrategyError {
  constructor(message: string) {
    super(message, "STALE_DATA", "error");
    this.name = "DataStaleError";
  }
}

export class ConfigError extends StrategyError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR", "error");
    this.name = "ConfigError";
  }
}
