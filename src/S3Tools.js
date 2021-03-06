/**
 * S3 Tools - This class will handle S3 calls
 */
'use strict';

const utils = require('./utils');
const zlib = require('zlib');

const BAD_PARAM = "S3_TOOLS_BAD_PARAM";
const GET_OBJECT_RETURN_TYPE_ALLOWED = ["string", "buffer", "object", "all"];
const FILE_NOT_EXIST = "FILE_NOT_FOUND";

class S3Tools {
    constructor(cli, opt = {}) {
        this.cli = cli;
        this.retryMax = opt.retryMax || 5;
    }

    /**
     *  Get object function for S3 with retry in exponential backoff
     *
     * @param {string} bucket - The bucket where the object we want to get are
     * @param {string} key - The key corresponding to the object we want to get
     * @param returnType
     * @param gzip
     */
    getObject(bucket, key, returnType = "object", gzip = false) {
        return new Promise((resolve, reject) => {
            if (typeof bucket !== "string" || typeof key !== "string" || GET_OBJECT_RETURN_TYPE_ALLOWED.indexOf(returnType) === -1 || typeof gzip !== "boolean") return reject(new Error(`${BAD_PARAM}_GetObject`));
            const param = {
                Bucket: bucket,
                Key: key
            };

            this.cli.getObject(param, async (err, data) => {
                if (err) {
                    if (err.retryable) {
                        try {
                            const data = await utils.retry(this.cli.getObject.bind(this.cli), [param], true, this.retryMax);
                            const response = await this._formatGetObjectResponse(data, returnType, gzip);
                            return resolve(response);
                        } catch (err) {
                            return reject(err);
                        }
                    }
                    return reject(err);
                }

                //If there is no body, we reject an error to notify that the file not exist
                if (!data.Body || !Buffer.isBuffer(data.Body)) {
                    return reject(new Error(FILE_NOT_EXIST));
                }

                const response = this._formatGetObjectResponse(data, returnType, gzip);
                return resolve(response);
            })
        })
    }

     /**
     *  Get object function for S3 with retry in exponential backoff
     *
     * @param {string} bucket - The bucket where the object we want to get are
     * @param {string} key - The key corresponding to the object we want to get
     * @param {Object} json object to upload
     */
    putJsonObject(bucket, key, json) {
        return new Promise((resolve, reject) => {
            if (typeof bucket !== "string" || typeof key !== "string" || typeof json !== "object") return reject(new Error(`${BAD_PARAM}_PutObject`));
            const param = {
                Bucket: bucket,
                Key: key,
                Body: JSON.stringify(json),
                ContentType: "application/json"
            };

            this.cli.putObject(param, async (err, data) => {
                if (err) {
                    if (err.retryable) {
                        try {
                            const response = await utils.retry(this.cli.putObject.bind(this.cli), [param], true, this.retryMax);
                            return resolve(response);
                        } catch (err) {
                            return reject(err);
                        }
                    }
                    return reject(err);
                }
                return resolve(data);
            })
        })
    }

    /**
     * Format the S3 response for GetObject
     *
     * @param {object} data - Response of S3
     * @param {string} returnType - Type of responsd waited
     * @param {boolean} gzip - Gzip or not
     */
    _formatGetObjectResponse(data, returnType, gzip) {
        return new Promise((resolve, reject) => {
            //Check wich return type is ask to returning well formatted data
            switch (returnType) {
                case "buffer":
                    if (!gzip) return resolve(data.Body);
                    zlib.gunzip(data.Body, (err, data) => {
                        if (err) return reject(err);
                        return resolve(data);
                    });
                    break;
                case "string":
                    if (!gzip) return resolve(data.Body.toString());
                    zlib.gunzip(data.Body, (err, data) => {
                        if (err) return reject(err);
                        return resolve(data.toString());
                    });
                    break;
                case "object":
                    if (!gzip) return resolve(JSON.parse(data.Body.toString()));
                    zlib.gunzip(data.Body, (err, data) => {
                        if (err) return reject(err);
                        return resolve(JSON.parse(data.toString()));
                    });
                    break;
                default:
                    return resolve(data);
            }
        });
    }

    /**
     * Empty a directory. S3 should automatically delete the directory.
     * @param {String} bucket 
     * @param {String} dir 
     */
    async emptyS3Directory(bucket, dir) {
        const listParams = {
            Bucket: bucket,
            Prefix: dir
        };
        const listedObjects = await this.cli.listObjectsV2(listParams).promise();

        if (listedObjects.Contents.length === 0) return;
    
        const deleteParams = {
            Bucket: bucket,
            Delete: { Objects: [] }
        };
    
        listedObjects.Contents.forEach(({ Key }) => {
            deleteParams.Delete.Objects.push({ Key });
        });
    
        await this.cli.deleteObjects(deleteParams).promise();
    
        if (listedObjects.IsTruncated) await this.emptyS3Directory(bucket, dir).bind(this);
    }
}

module.exports = S3Tools;
