// tslint:disable-next-line:no-implicit-dependencies
import * as awsLambda from "aws-lambda";
import { RootContainer } from "./container";
import { validationError } from "./errors";
import { ContainerFactoryOptions, ContainerFunction } from "./lambda-container";
import { defaultConfidentialityReplacer, safeJSONStringify } from "./utils";
import { validate } from "./validator";

export interface LambdaFunctionArgs<T> {
  /** The Lambda Context */
  context: awsLambda.Context;
  /** The Lambda Event */
  event: T;
}

export interface LambdaError {
  context: awsLambda.Context;
  error: any;
  event: any;
}

export interface LambdaOptions {

  /**
   * Validation options. Will run before the function.
   */
  validation?: {

    /**
     * Will validate the event based on the schema.
     */
    event?: {};
  };

  /**
   * The custom error logger to use.
   * If not provided, will use console.error.
   */
  errorLogger?(error: LambdaError): void | Promise<void>;
}

const defaultErrorLogger = async (error: LambdaError) => {

  const payload = {
    context: error.context,
    error: error.error,
    errorStackTrace: error.error.stack,
    event: error.event,
  };

  const JSON_STRINGIFY_SPACE = 2;

  console.error(safeJSONStringify(payload, defaultConfidentialityReplacer, JSON_STRINGIFY_SPACE));
};

export type LambdaFunction<T> =
  (args: LambdaFunctionArgs<T>) => Promise<any>;

/**
 * Creates a wrapper for a simple invocation Lambda function.
 * @param func - The function to wrap.
 * @param options - various options.
 */
export const lambda = <T>(func: LambdaFunction<T>, options: LambdaOptions = {}): awsLambda.Handler<T> =>
  async (event: T, context: awsLambda.Context, callback: awsLambda.Callback)
  : Promise<any> => {
    try {

      if (options.validation && options.validation.event) {
        const validationErrors = validate(options.validation.event, event, "event");
        if (validationErrors.length > 0) {
          throw validationError(validationErrors);
        }
      }

      return await func({
        context,
        event,
      });
    } catch (error) {
      if (!options.errorLogger) {
        options.errorLogger = defaultErrorLogger;
      }

      try {
        const loggerPromise = options.errorLogger({ event, context, error });
        if (loggerPromise) {
          await loggerPromise;
        }
      } catch (loggerError) {
        console.error(loggerError);
      }

      throw error;
    }
  };

/**
 * Creates a wrapper for a Lambda authorizer function for a bearer token.
 * Manages a scoped container execution.
 * @param func - The function to wrap.
 */
export const containerLambda = <TEvent, TContainerContract>(
  func: ContainerFunction<LambdaFunctionArgs<TEvent>, TContainerContract, Promise<any>>,
  options: LambdaOptions & ContainerFactoryOptions<TEvent, TContainerContract>)
  : awsLambda.Handler<TEvent> => {
    let rootContainer: RootContainer<TContainerContract> | undefined;

    return lambda(
      async (args) => {
        if (!rootContainer) {
          rootContainer = options.containerFactory({ context: args.context, event: args.event });
        }

        const scopedContainer = rootContainer.scope();

        return func(args, scopedContainer);
      },
      options);
  };
