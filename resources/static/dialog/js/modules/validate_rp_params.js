/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
BrowserID.Modules.ValidateRpParams = (function() {
  "use strict";

  /**
   * This module validates parameters that come from the RP.
   * the validate method is called with paramsFromRP and returns params, a list
   * of cleaned parameters than can be assumed to be safe.
   */

  var bid = BrowserID,
      storage = bid.Storage,
      helpers = bid.Helpers,
      complete = helpers.complete,
      sc;

  var Module = bid.Modules.Module.extend({
    start: function(options) {
      var self = this;

      self.window = options.window || window;

      sc.start.call(self);

      complete(options.ready);
    },
    validate: function(paramsFromRP) {
      var self = this,
          hash = self.window.location.hash;

      var origin_url = paramsFromRP.origin_url;

      // Security Note: paramsFromRP is the output of a JSON.parse on an
      // RP-controlled string. Most of these fields are expected to be simple
      // printable strings (hostnames, usernames, and URLs), but we cannot
      // rely upon the RP to do that. In particular we must guard against
      // these strings containing <script> tags. We will populate a new
      // object ("params") with suitably type-checked properties.
      var params = {};

      // verify params
      var startTime = paramsFromRP.start_time;
      if (startTime) {
        params.startTime = validateStartTime(startTime);
      }

      var rpAPI = paramsFromRP.rp_api;
      if (rpAPI) {
        // throws if an invalid rp_api value
        params.rpAPI = validateRPAPI(rpAPI);
      }

      if (paramsFromRP.requiredEmail) {
        helpers.log("requiredEmail has been deprecated");
      }

      // support old parameter names if new parameter names not defined.
      if (paramsFromRP.tosURL && !paramsFromRP.termsOfService)
        paramsFromRP.termsOfService = paramsFromRP.tosURL;

      if (paramsFromRP.privacyURL && !paramsFromRP.privacyPolicy)
        paramsFromRP.privacyPolicy = paramsFromRP.privacyURL;

      if (paramsFromRP.termsOfService && paramsFromRP.privacyPolicy) {
        params.termsOfService = fixupURL(origin_url, paramsFromRP.termsOfService);
        params.privacyPolicy = fixupURL(origin_url, paramsFromRP.privacyPolicy);
      }

      var validLogoSchemes = {"https": 1, 'data': 1};
      // 'data:image/png;base64,iV...' -> ['data:image/png;base64,iV...', 'image', 'png', ...]
      // ... therefore mimetype -> [1]/[2]
      var dataUriRegex = /^data:(.+)\/(.+);base64,(.*)$/;
      var dataMatches = null;
      // who needs a shared mimetype parsing library?
      var imageMimeTypes = {'png': 1, 'gif': 1, 'jpg': 1, 'jpeg':1, 'svg': 1}
      if (paramsFromRP.siteLogo) {
        dataMatches = paramsFromRP.siteLogo.match(dataUriRegex);
        if (dataMatches) {
    if ((dataMatches[1].toLowerCase() === 'image')
               &&
              (dataMatches[2].toLowerCase() in imageMimeTypes)) {
              ; // Good to go.
          } else {
            throw new Error("bad data URI for siteLogo: " + paramsFromRP.siteLogo.slice(0, 15) + " ...");
          }
  } else {
          // Regularize URL; throws error if input is relative.
          params.siteLogo = fixupURL(origin_url, paramsFromRP.siteLogo);
          /*jshint newcap:false*/
          if (!(URLParse(params.siteLogo).scheme in validLogoSchemes)) {
            // This is kind of misleading as URLParse won't actually recognize
            // the data scheme.
            throw new Error("siteLogos can only be served from " + _.keys(validLogoSchemes).join(' and ') + " schemes.");
          }
        }
      }

      if (paramsFromRP.backgroundColor) {
        var backgroundColor = validateBackgroundColor(paramsFromRP.backgroundColor);
        if (backgroundColor) params.backgroundColor = backgroundColor;
      }

      if (paramsFromRP.siteName) {
        params.siteName = _.escape(paramsFromRP.siteName);
      }

      // returnTo is used for post verification redirection.  Redirect back
      // to the path specified by the RP.
      if (paramsFromRP.returnTo) {
        params.returnTo = fixupReturnTo(origin_url, paramsFromRP.returnTo);
      }

      // forceAuthentication is used by the Marketplace to ensure that the
      // user knows the password to this account. We ignore any active session.
      if (paramsFromRP.experimental_forceAuthentication) {
        params.forceAuthentication = validateBoolean(
            paramsFromRP.experimental_forceAuthentication,
            "experimental_forceAuthentication");
      }

      // forceIsuser is used by the Marketplace to disable primary support
      // and replace fxos.login.persona.org as the issuer of certs
      if (paramsFromRP.experimental_forceIssuer) {
        params.forceIssuer =
            fixupIssuer(paramsFromRP.experimental_forceIssuer);
      }

      // allowUnverified means that the user doesn't need to have
      // verified their email address in order to send an assertion.
      // if the user *has* verified, it will be a verified assertion.
      if (paramsFromRP.experimental_allowUnverified) {
        params.allowUnverified = validateBoolean(
            paramsFromRP.experimental_allowUnverified,
            "experimental_allowUnverified");
      }

      if (hash.indexOf("#AUTH_RETURN") === 0) {
        var primaryParams = storage.idpVerification.get();
        if (!primaryParams)
          throw new Error("Could not get IdP Verification Info");

        params.email = primaryParams.email;
        params.add = primaryParams.add;
        params.type = "primary";
        params.cancelled = false;
      }

      if (hash.indexOf("#AUTH_RETURN_CANCEL") === 0) {
        params.cancelled = true;
      }

      return params;
    }
  });

  sc = Module.sc;

  function fixupURL(origin, url) {
    var u;
    if (typeof(url) !== "string")
      throw new Error("urls must be strings: (" + url + ")");
    /*jshint newcap:false*/
    if (/^http(s)?:\/\//.test(url)) u = URLParse(url);
    else if (/^\/[^\/]/.test(url)) u = URLParse(origin + url);
    else throw new Error("relative urls not allowed: (" + url + ")");
    // encodeURI limits our return value to [a-z0-9:/?%], excluding <script>
    var encodedURI = encodeURI(u.validate().normalize().toString());

    // All browsers have a max length of URI that they can handle. IE8 has the
    // shortest total length at 2083 bytes.  IE8 can handle a path length of
    // 2048 bytes. See http://support.microsoft.com/kb/q208427

    // Check the total encoded URI length
    if (encodedURI.length > bid.URL_MAX_LENGTH)
      throw new Error("urls must be < " + bid.URL_MAX_LENGTH + " characters");

    // Check just the path portion.  encode the path to make sure the full
    // length is checked.
    if (encodeURI(u.path).length > bid.PATH_MAX_LENGTH)
      throw new Error("path portion of a url must be < " + bid.PATH_MAX_LENGTH + " characters");

    return encodedURI;
  }

  function fixupAbsolutePath(origin_url, path) {
    // Ensure URL is an absolute path (not a relative path or a scheme-relative URL)
    if (/^\/[^\/]/.test(path))  return fixupURL(origin_url, path);

    throw new Error("must be an absolute path: (" + path + ")");
  }

  function fixupReturnTo(origin_url, path) {
    // "/" is a valid returnTo, but it is not a valid path for any other
    // parameter. If the path is "/", allow it, otherwise pass the path down
    // the normal checks.
    var returnTo = path === "/" ?
      origin_url + path :
      fixupAbsolutePath(origin_url, path);
    return returnTo;
  }

  function fixupIssuer(issuer) {
    // An issuer should not have a scheme on the front of it.
    // The URL parser requires a scheme. Prepend the scheme to do the
    // verification.
    /*jshint newcap:false*/
    var u = URLParse("http://" + issuer);
    if (u.host !== issuer) {
      var encodedURI = encodeURI(u.validate().normalize().toString());
      throw new Error("invalid issuer: " + encodedURI);
    }

    return issuer;
  }

  function validateBackgroundColor(value) {

    if (value.substr(0, 1) === '#') {
      value = value.substr(1);
    }

    // Check if this is valid hex color
    if (!value.match(/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/)) {
      throw new Error('invalid backgroundColor: ' + value);
    }

    if (value.length === 6) {
      return value;
    }

    // Normalize 3- to 6-character hex color
    var bits = [];
    for (var i = 0; i < 3; i++) {
      bits.push(value.charAt(i) + value.charAt(i));
    }

    return bits.join('');

  }

  function validateRPAPI(rpAPI) {
    var VALID_RP_API_VALUES = [
      "watch_without_onready",
      "watch_with_onready",
      "get",
      "getVerifiedEmail",
      "internal"
    ];

    if (_.indexOf(VALID_RP_API_VALUES, rpAPI) === -1) {
      throw new Error("invalid value for rp_api: " + rpAPI);
    }

    return rpAPI;
  }

  function validateStartTime(startTime) {
    var parsedTime = parseInt(startTime, 10);
    if (typeof parsedTime !== "number" || isNaN(parsedTime)) {
      throw new Error("invalid value for start_time: " + startTime);
    }

    return parsedTime;
  }

  function validateBoolean(bool, name) {
    if (typeof bool !== "boolean") {
      throw new Error("invalid value for " + name + ": " + bool);
    }

    return bool;
  }

  return Module;

}());

