/**
 * An error associated with missing access rights to a resource.
 */
export class AccessError extends Error {
  /**
   * @param {string=} [message='Unauthorized'] Error message
   * @param {number=} [code=401] Error code
   */
  constructor(message='Unauthorized', code=401) {
    super(message);
    this.code = code;
  }
}

/**
 * An error associated with client parameters issues.
 */
export class ClientError extends Error {
  /**
   * @param {string=} [message='Invalid request'] Error message
   * @param {number=} [code=400] Error code
   */
  constructor(message='Invalid request', code=400) {
    super(message);
    this.code = code;
  }
}
