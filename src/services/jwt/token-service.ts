import * as jwt from "jsonwebtoken";
import { SigningKeyService } from "./signing-key-service";

/**
 * Complementary claims added by the signing process.
 */
export interface TokenClaims {
  aud?: string;
  exp?: number;
  iat?: number;
  iss?: string;
}

/**
 * Defines a component that takes a token, verify its validity
 * and returns the associated identity information.
 */
export interface TokenService {
  decode<T extends object>(token: string): Promise<T | undefined>;
  sign<T extends object>(payload: T): Promise<string>;
  verify<T extends object>(token: string): Promise<T>;
}

export interface JWTTokenServiceOptions {
  audience?: string | Promise<string>;
  issuer?: string | Promise<string>;
  expiration?: string | number | Promise<string | number>;
}

/**
 * TokenService implementation that verify & sign JSON Web Token
 * using a SigningKeyService.
 */
export class JWTTokenService implements TokenService {

  public constructor(
    private readonly options: JWTTokenServiceOptions,
    private readonly keyService: SigningKeyService) {}

  public async decode<T extends object>(token: string): Promise<T | undefined> {
    const decoded = jwt.decode(token, { complete: true }) as any;
    return decoded
      ? decoded.payload as T
      : undefined;
  }

  public async sign<T extends object>(payload: T): Promise<string> {
    const finalPayload = {
      aud: await this.options.audience,
      iss: await this.options.issuer,
      ... payload as object,
    };

    const privateKey = await this.keyService.getSecretOrPrivateKey();

    return jwt.sign(
      finalPayload,
      privateKey.key,
      {
        algorithm: privateKey.alg,
        expiresIn: await this.options.expiration || "1h",
        keyid: privateKey.kid,
      });
  }

  public async verify<T>(token: string): Promise<T> {
    const decodedToken = jwt.decode(token, { complete: true }) as any;
    const keyId = decodedToken && decodedToken.header && decodedToken.header.kid
      ? decodedToken.header.kid
      : undefined;

    const publicKey = await this.keyService.getSecretOrPublicKey(keyId);

    return jwt.verify(token, publicKey) as any;
  }
}