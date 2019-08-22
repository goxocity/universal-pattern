const debug = require('debug')('universal-pattern:libs:swagger-metadata');

const getParameters = (swagger, url, method) => {
  const globalParameters = swagger.parameters;
  const localParameters = swagger.paths[url][method].parameters;
  if (localParameters) {
    return localParameters.map((p) => {
      if (p.$ref) {
        const k = p.$ref.replace('#/parameters/', '');
        return globalParameters[k];
      }
      return p;
    })
      .reduce((acc, current) => {
        if (current.schema) {
          if (current.schema.$ref) {
            const parts = current.schema.$ref.replace('#/', '').split('/');
            current.schema = swagger[parts[0]][parts[1]];
          }
        }
        return ({ ...acc, [current.name]: current });
      }, {});
  }
  return {};
};


const validString = (req, method, prop, meta) => {
  debug('validString called: ', method, prop, meta);
  let n;
  const emailRegex = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  const p = req[method][prop];
  if (meta.required && !p) throw new Error(`required string: ${prop}`);
  if (meta.format === 'date') {
    n = new Date(p);
    if (n.toString() === 'Invalid Date') throw new Error(`Invalid date format: ${prop}`);
    return n;
  }

  if (meta.format === 'email') {
    if (!emailRegex.test(String(p).toLowerCase())) throw new Error(`Invalid email format: ${prop}`);
    return String(p).toLowerCase();
  }

  if (meta['x-swagger-regex']) {
    if (!RegExp(meta['x-swagger-regex']).test(p)) throw new Error(`Invalid x-swagger-regex: ${meta['x-swagger-regex']} ${prop}`);
    return p;
  }

  if (p) {
    if (meta.enum && meta.enum.indexOf(p) === -1) throw new Error(`Invalid value enum: ${prop}`);
    if (meta.minLength && meta.minLength > p.length) throw new Error(`Invalid minLength: ${prop} (${p.length})`);
    if (meta.maxLength && meta.maxLength < p.length) throw new Error(`Invalid maxLength: ${prop} (${p.length})`);
    return p;
  }
  return meta.default;
};

const validNumber = (req, method, prop, meta) => {
  debug('validNumber: ', prop, meta);
  let n;
  const p = req[method][prop];
  if (meta.required && !p) throw new Error(`require number: ${prop}`);
  if (p) {
    if (meta.format === 'float') n = parseFloat(p, 10);
    else n = parseInt(p, 10);
    if (Number.isNaN(n)) throw new Error('Invalid number format');
  }
  return n || meta.default || p;
};

const validArray = (req, method, prop, meta) => {
  debug('validArray: ', prop, meta);
  let n;
  const p = req[method][prop];
  if (meta.required && !p) throw new Error(`require array: ${prop}`);
  if (p) {
    if (!Array.isArray(p)) throw new Error('Invalid array');
    if (meta.minLength && p.length < meta.minLength) throw new Error('Invalid minLength array');
    if (meta.items && meta.items.type) {
      p.forEach((k) => {
        let ok = false;
        if (meta.items.type === 'object') ok = Object.prototype.toString.call(k) === '[object Object]';
        if (meta.items.type === 'integer' || meta.items.type === 'number') ok = Object.prototype.toString.call(k) === '[object Number]';
        if (meta.items.type === 'array') ok = Array.isArray(k);
        if (meta.items.type === 'string') ok = Object.prototype.toString.call(k) === '[object String]';
        if (!ok) throw new Error(`Invalid format item type: ${k} , required ${meta.items.type}`);
      });
    } else n = p;
  }
  return n || meta.default || p;
};

const validObject = (req, method, prop, meta) => {
  debug('validObject called: ', prop, meta);
  if (method === 'post') {
    // const { body } = req;
    // const { schema } = meta;
  }
  return req.body;
};


const validateParameters = (req, params, level = {}) => {
  debug('validateParameters called: ', params, level);
  Object.entries(params)
    .forEach(([k, v]) => {
      try {
        let method = v.in === 'header' ? 'headers' : v.in || 'body';
        if (v.schema) {
          method = 'body';
        }
        if (v.schema && v.schema.type === 'object') {
          level[k] = { value: {} };
          return validateParameters(req, v.schema.properties, level[k].value);
        }
        if (v.type === 'number' || v.type === 'integer') {
          const value = validNumber(req, method, k, v);
          if (method === 'body') {
            if (value) Object.assign(level, { [k]: value });
          } else Object.assign(level, { [k]: { value } });
          return level;
        }


        if (v.type === 'string') {
          const value = validString(req, method, k, v);
          if (method === 'body') {
            if (value) Object.assign(level, { [k]: value });
          } else Object.assign(level, { [k]: { value } });
          return level;
        }

        if (v.type === 'array') {
          const value = validArray(req, method, k, v);
          if (method === 'body') {
            if (value) Object.assign(level, { [k]: value });
          } else Object.assign(level, { [k]: { value } });
          return level;
        }

        if (v.type === 'object') {
          const value = validObject(req, method, k, v);
          if (value) {
            if (method === 'body') Object.assign(level, { [k]: value });
            else Object.assign(level, { [k]: { value } });
            return level;
          }
        }

        if (v.type === 'file') {
          console.info('type file: ', req.body);
          // Object.assign(level, { [k]: { value } });
          return level;
        }

        Object.assign(level, { [k]: { value: req[method][k] } });
        return level;
      } catch (err) {
        console.error('invalid model data validation: ', err);
        throw Error(`invalid model data validation: ${err.toString()}`);
      }
    });
  return level;
};

const swaggerMetadata = (Application) => {
  debug('swaggerMetadata constructor called');
  const { swagger } = Application;
  const getPath = url => url.split('?').shift().replace(swagger.basePath, '');

  return (req, res, next) => {
    const url = getPath(req.url);
    const method = req.method.toLowerCase();
    req.swagger = {
      params: {},
      apiPath: url,
    };

    debug('swaggerMetadata called: ', req.url, url, method);

    if (swagger.paths[url] && swagger.paths[url][method]) {
      try {
        const data = getParameters(swagger, url, method, req);
        validateParameters(req, data, req.swagger.params);
        const keys = Object.keys(req.body);
        if (keys.length > 0) {
          keys.forEach((k) => {
            if (!req.swagger.params.modeldata.value[k]) {
              req.swagger.params.modeldata.value[k] = req.body[k];
            }
          });
        }


        if (data.modeldata && data.modeldata.schema) {
          req.swagger.params.modeldata['x-swagger-lookup'] = [];
          if (data.modeldata.schema['x-swagger-model-version']) req.swagger.params['x-swagger-model-version'] = data.modeldata.schema['x-swagger-model-version'];
          else req.swagger.params['x-swagger-model-version'] = 1;

          if (data.modeldata.schema.properties) {
            Object.keys(data.modeldata.schema.properties).forEach((key) => {
              const item = data.modeldata.schema.properties[key];
              if (item['x-swagger-lookup']) {
                req.swagger.params.modeldata['x-swagger-lookup'].push({ ...item['x-swagger-lookup'], field: key });
              }
            });
          }
        }
        debug('params formatted: ', req.swagger.params);
        return next();
      } catch (error) {
        debug('invalid request: ', req.url, req.swagger, error);
        return res.status(400).end(`Invalid parameters: ${error}`);
      }
    }
    return next();
  };
};

module.exports = swaggerMetadata;
