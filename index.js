const express = require('express');
const MongoClient = require('mongodb').MongoClient;
const cors = require('cors');
const bodyParser = require('body-parser');
const pino = require('express-pino-logger')();
const assert = require('assert');
const jwksRsa = require("jwks-rsa");
const jwt = require("express-jwt");
const jwtAuthz = require("express-jwt-authz");
//const authConfig = require(".auth/auth_config.json");
const { ClientCredentials } = require('simple-oauth2');
const fetch = require('node-fetch');

const app = express();

const port = 3001;
const appPort = 3000;
const appOrigin = `http://localhost:${appPort}`;

const dbName = "envyofeden";
const uri = 'mongodb://superuser:password@localhost:27017';

/*
if (!authConfig.domain || !authConfig.audience) {
  throw new Error(
    "Please make sure that auth_config.json is in place and populated."
  );
}
*/

const client = new MongoClient(uri, { useUnifiedTopology: true });

var jsonParser = bodyParser.json();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(pino);
app.use(cors({ origin: appOrigin }));

var db;

const authorizeAccessToken = jwt({
  // Dynamically provide a signing key
  // based on the kid in the header and 
  // the signing keys provided by the JWKS endpoint.
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://envyofeden.us.auth0.com/.well-known/jwks.json`
  }),
  
  // Validate the audience and the issuer.
  audience: 'https://envyofeden.api',
  issuer: `https://envyofeden.us.auth0.com/`,
  algorithms: ['RS256']
});

//console.log(authorizeAccessToken);

const checkPermissions = jwtAuthz(["view:applications"], {
  customScopeKey: "permissions",
  checkAllScopes:true
});

client.connect(
    function (err) {
        assert.strictEqual(null, err);
        console.log("Connected to server successfully.");
        db = client.db(dbName);
        app.listen(port);
    }
);

app.get('/api/view-applications', authorizeAccessToken, checkPermissions, (req, res) => {
  res.status(401).send(false);
  res.status(403).send(false);
  res.send(true);
});

// BLIZZARD API STUFF
// TODO: Put the id/secret in an .env file
const client_id = '1c6a420988a34f45b4506ca6e66ca809';
const client_secret = 'mGPbV7RQxACH5ESve7d7dwtURP4haobx';

// TODO: Don't fetch a new token every time this call is made. Maybe store the full token
// in the database
const getToken = new Promise((resolve, reject) => {
  // TODO: The host will change depending on the region. (US, EU, TW, KR)
  const host = `https://us.battle.net`

  // Auth2 config object
  const config = {
    client: {
      id: client_id,
      secret: client_secret 
    },
    auth: {
      tokenHost: host
    }
  };

  const authclient = new ClientCredentials(config);

  // TODO: Will need to add scope-handling if I do anything with profile stuff
  const tokenParams = {
    scope: ''
  };
  
  try {
    authclient.getToken(tokenParams)
      .then(token => resolve(token.token.access_token));
  } catch(error) {
    reject(error);
  }
});

app.get('/api/get-spec-info', (req, res) => {
  // Fetch spec data from the DB
  const specs = db.collection('specializations').find().toArray();
  
  specs
    .then(data => {
      // Sort specs first
      data.sort((a,b) => {
        if (a.spec < b.spec)
          return -1;
        else if (a.spec > b.spec)
          return 1;
        return 0;
      });

      // Sort the classes next
      data.sort((a,b) => {
        if (a.class < b.class)
          return -1;
        else if (a.class > b.class)
          return 1;
        return 0;
      });

      return data;
    })
    .then(output => res.send(output))
    .catch(error => console.log(error));

  /*
  // Code for fetching spec data from Blizzard API
  // Object to hold the output returned by this call
  const fullSpecInfo = [];
  
  // Fetch the token used to access the Blizzard API
  const token = getToken;

  // Fetch an index of all specs
  const specIndex = token
    .then(token => fetch(`https://us.api.blizzard.com/data/wow/playable-specialization/index?namespace=static-us&locale=en_US&access_token=${token}`))
    .then(response => response.json())
    .then(specs => specs.character_specializations.map(entry => ({id: entry.id, name: entry.name})))
    .catch(error => console.log("Error fetching indexes: ", error));

  // Fetch the information for each spec; used to get the class for each spec
  const specClassInfo = Promise.all([token, specIndex])
    .then(data => {
      const token = data[0];
      const specs = data[1];
      const results = [];
      specs.forEach(spec => {
        const apiCall = `https://us.api.blizzard.com/data/wow/playable-specialization/${spec.id}?namespace=static-us&locale=en_US&access_token=${token}`;
        results.push(fetch(apiCall));
      });
      return Promise.all(results);
    })
    .then(responses => {
      const results = [];
      responses.forEach(response => {
        console.log(response);
        results.push(response.json());
      });
      return Promise.all(results);
    })
    .then(specInfo => {
      console.log("Made it to class mapping");
      specInfo.map(entry => ({class: entry.playable_class.name}));
    })
    .catch(error => console.log("Error fetching classes: ",error));

    // Fetch the media image associated with each spec
    const specMedia = Promise.all([token, specIndex])
    .then(data => {
      const token = data[0];
      const specs = data[1];
      const results = [];
      specs.forEach(spec => {
        const apiCall = `https://us.api.blizzard.com/data/wow/media/playable-specialization/${spec.id}?namespace=static-us&locale=en_US&access_token=${token}`;
        results.push(fetch(apiCall));
      });
      return Promise.all(results);
    })
    .then(responses => {
      const results = [];
      responses.forEach(response => {
        results.push(response.json());
      });
      return Promise.all(results);
    })
    .then(specInfo => specInfo.map(entry => ({media: entry.assets.value})))
    .catch(error => console.log("Error fetching media: ", error));

    Promise.all([specIndex, specClassInfo, specMedia])
      .then(data => {
        //console.log(data);
        const specs = data[0];
        const classes = data[1];
        const media = data[2];

        specs.forEach((spec,index) => {
          fullSpecInfo.push({
            id: spec.id,
            spec: spec.name,
            class: classes[index].class,
            media: media[index].media
          });
        });
      })
      .then(specs => {
        console.log("then",specs);
        console.log(fullSpecInfo);
      })
      .catch(error => console.log(error));
      */
});

app.get('/api/get-servers', (req, res) => {
  
  const regions = ['us', 'eu', 'kr', 'tw'];
  const serverIndex = {
    'us': {
      servers: ["Error loading US servers"]
    },
    'eu': {
      servers: ["Error loading EU servers"]
    },
    'kr': {
      servers: ["Error loading KR servers"]
    },
    'tw': {
      servers: ["Error loading TW servers"]
    },
  };
  
  getToken
    .then(token => {
      const fetchedServers = [];
      regions.forEach(region => {
          const apiCall = `https://${region}.api.blizzard.com/data/wow/realm/index?namespace=dynamic-${region}&locale=en_US&access_token=${token}`;
          fetchedServers.push(fetch(apiCall));
      });
      return Promise.all(fetchedServers);
    })
    .then(responses => {
      const results = [];
      responses.forEach(response => {
        results.push(response.json());
      });
      return Promise.all(results);
    })
    .then(regions => {
      regions.forEach(serverList => {
        const region = serverList._links.self.href.slice(-2);
        serverIndex[region].servers = serverList.realms.map(x => x.name).sort();
      })
    })
    .then(() => res.send(serverIndex))
    .catch(error => console.log(error));
});
// BLIZZARD API STUFF

// Send the Auth0 user permissions back to the client 
app.get('/api/get-permissions', authorizeAccessToken, (req, res) => {
  res.send(req.user.permissions);
});

app.get('/api/get-applications', (req, res) => {

  const questions = db.collection('questions').find().toArray();
  const applications = db.collection('applications').find().toArray();

  Promise.all([questions, applications])
    .then((data) => {
      res.send({questions: data[0], applications: data[1]})
    })
    .catch(error => console.log(error));
});

app.post('/api/submit', jsonParser, function (req, res) {
    // Sending request to create a data
    // console.log(req.body.post);
    db.collection('applications').insertOne(req.body.post, function (
      err,
      info
    ) {
      res.json(info.ops[0])
    });
});

app.get('/api/get-questions', (req, res) => {

  const questions = db.collection('questions').find().toArray();

  questions.then(questions => res.send(questions));
});