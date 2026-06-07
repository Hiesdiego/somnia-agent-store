import { createLogger, format, transports } from "winston";

export const logger = createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.colorize(),
    format.printf(({ timestamp, level, message, ...meta }) => {
      const extras = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
      return `${timestamp} [${level}] ${message}${extras}`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({
      filename: "logs/runner-error.log",
      level: "error",
      format: format.combine(format.uncolorize(), format.json()),
    }),
    new transports.File({
      filename: "logs/runner-combined.log",
      format: format.combine(format.uncolorize(), format.json()),
    }),
  ],
});
