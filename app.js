/*
 Copyright 2019 IBM Corp.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
 http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const appID = require("ibmcloud-appid");
const bodyParser = require("body-parser");

const WebAppStrategy = appID.WebAppStrategy;

const app = express();

// const CALLBACK_URL = "/ibm/cloud/appid/callback";
const CALLBACK_URL = "/index.html";
const LANDING_PAGE_URL = "/protected/protected.html";
const LOGIN_URL = "/";
const ROP_LOGIN_PAGE_URL = "/";

const port = process.env.PORT || 3000;

// Setup express application to use express-session middleware
// Must be configured with proper session storage for production
// environments. See https://github.com/expressjs/session for
// additional documentation
app.use(
  session({
    secret: "123456",
    resave: true,
    saveUninitialized: true,
    proxy: true,
  })
);

// Configure express application to use passportjs
app.use(passport.initialize());
app.use(passport.session());

// let webAppStrategy = new WebAppStrategy(getAppIDConfig());
// passport.use(webAppStrategy);
// Configure passportjs to use WebAppStrategy
let webAppStrategy = new WebAppStrategy({
  tenantId: "c3bbedbe-b619-440f-af76-4cbb87d91274",
  clientId: "0f6fd50c-575f-4144-96ac-c209efacba65",
  secret: "NGY2NTk3YjgtYmJhZS00YjE5LWExNTItMWNiNGQ5Nzg4YjUy",
  oauthServerUrl:
    "https://us-south.appid.cloud.ibm.com/oauth/v4/c3bbedbe-b619-440f-af76-4cbb87d91274",
  redirectUri: "http://localhost:3000" + CALLBACK_URL,
});
passport.use(webAppStrategy);

// Configure passportjs with user serialization/deserialization. This is required
// for authenticated session persistence accross HTTP requests. See passportjs docs
// for additional information http://passportjs.org/docs
passport.serializeUser((user, cb) => cb(null, user));
passport.deserializeUser((obj, cb) => cb(null, obj));

// Callback to finish the authorization process. Will retrieve access and identity tokens/
// from AppID service and redirect to either (in below order)
// 1. the original URL of the request that triggered authentication, as persisted in HTTP session under WebAppStrategy.ORIGINAL_URL key.
// 2. successRedirect as specified in passport.authenticate(name, {successRedirect: "...."}) invocation
// 3. application root ("/")
app.get(
  CALLBACK_URL,
  passport.authenticate(WebAppStrategy.STRATEGY_NAME, {
    failureRedirect: "/error",
    session: false,
  })
);

function storeRefreshTokenInCookie(req, res, next) {
  const refreshToken = req.session[WebAppStrategy.AUTH_CONTEXT].refreshToken;
  if (refreshToken) {
    /* An example of storing user's refresh-token in a cookie with expiration of a month */
    res.cookie("refreshToken", refreshToken, {
      maxAge: 1000 * 60 * 60 * 24 * 30 /* 30 days */,
    });
  }
  next();
}

function isLoggedIn(req) {
  return req.session[WebAppStrategy.AUTH_CONTEXT];
}

// // Protect everything under /protected
// app.use(
//   "/protected",
//   passport.authenticate(WebAppStrategy.STRATEGY_NAME, {
//     // session: false,
//     keepSessionInfo: true,
//     // failureRedirect: ROP_LOGIN_PAGE_URL,
//   })
// );
// Protected area. If current user is not authenticated - redirect to the login widget will be returned.
// In case user is authenticated - a page with current user information will be returned.
app.use(
  "/protected",
  function tryToRefreshTokenIfNotLoggedIn(req, res, next) {
    if (isLoggedIn(req)) {
      console.log(" logged in:", isLoggedIn(req));
      return next();
    } else {
      console.log("not logged in:", req);
      res.redirect("/");
    }

    // webAppStrategy
    //   .refreshTokens(req, req.cookies.refreshToken)
    //   .then(function () {
    //     next();
    //   });
  }
  //   ,
  //   passport.authenticate(WebAppStrategy.STRATEGY_NAME, {
  //     keepSessionInfo: true,
  //   }),
  //   storeRefreshTokenInCookie,
  //   function (req, res) {
  //     // logger.debug("/protected");
  //     res.json(req.user);
  //   }
);

// This will statically serve pages:
app.use(express.static("public"));

// Explicit login endpoint. Will always redirect browser to login widget due to {forceLogin: true}.
// If forceLogin is set to false redirect to login widget will not occur of already authenticated users.
app.get(
  LOGIN_URL,
  passport.authenticate(WebAppStrategy.STRATEGY_NAME, {
    successRedirect: LANDING_PAGE_URL,
    forceLogin: true,
  })
);

// This will statically serve the protected page (after authentication, since /protected is a protected area):
app.use("/protected", express.static("protected"));

app.get("/logout", (req, res) => {
  //Note: if you enabled SSO for Cloud Directory be sure to use webAppStrategy.logoutSSO instead.
  req._sessionManager = false;
  WebAppStrategy.logout(req);
  res.clearCookie("refreshToken");
  res.redirect("/");
});

//Serves the identity token payload
app.get("/protected/api/idPayload", (req, res) => {
  res.send(req.session[WebAppStrategy.AUTH_CONTEXT].identityTokenPayload);
});

app.post(
  "/rop/login/submit",
  bodyParser.urlencoded({
    extended: false,
  }),
  passport.authenticate(WebAppStrategy.STRATEGY_NAME, {
    successRedirect: LANDING_PAGE_URL,
    failureRedirect: ROP_LOGIN_PAGE_URL,
    failureFlash: false,
    keepSessionInfo: true,
  })
);

app.get("/error", (req, res) => {
  res.send("Authentication Error");
});

app.listen(port, () => {
  console.log("Listening on http://localhost:" + port);
});

function getAppIDConfig() {
  let config;

  try {
    // if running locally we'll have the local config file
    config = require("./localdev-config.json");
  } catch (e) {
    if (process.env.APPID_SERVICE_BINDING) {
      // if running on Kubernetes this env variable would be defined
      config = JSON.parse(process.env.APPID_SERVICE_BINDING);
      config.redirectUri = process.env.redirectUri;
    } else {
      // running on CF
      let vcapApplication = JSON.parse(process.env["VCAP_APPLICATION"]);
      return {
        redirectUri:
          "https://" + vcapApplication["application_uris"][0] + CALLBACK_URL,
      };
    }
  }
  return config;
}
