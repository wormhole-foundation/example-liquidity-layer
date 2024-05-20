import * as winston from "winston";

export function defaultLogger(args: { label: string; level: string }): winston.Logger {
    const { label, level } = args;

    return winston.createLogger({
        transports: [
            new winston.transports.Console({
                level,
            }),
        ],
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.label({ label }),
            winston.format.splat(),
            winston.format.timestamp({
                format: "YYYY-MM-DD HH:mm:ss.SSS",
            }),
            winston.format.errors({ stack: true }),
            winston.format.printf(({ level, message, label, timestamp }) => {
                return `${timestamp} [${label}] ${level}: ${message}`;
            })
        ),
    });
}
