var debug = require('debug')('disruptit');
var express = require('express');
var Barc = require('barcode-generator');
var Ticket = require('../models/Ticket');
var User   = require('../models/User');
var _      = require('underscore');
var async  = require('async');
var i18n   = require('i18next');

module.exports = function (config) {
var router = express.Router();


function auth(req, res, next) {
  if (!req.user) {
    req.session.lastPage = req.path;
    req.flash('info', 'You have to log in to visit page ' + req.path );
    return res.redirect('/login');
  }
  next();
}

function adminAuth(req, res, next) {
  if (!req.user || !req.user.admin) {
    req.session.lastPage = req.path;
    req.flash('info', 'You have to log in to visit page ' + req.path );
    return res.redirect('/login');
  }
  next();
}

router.get('/', function (req, res) {
  res.render('index', { title: '', ticketSaleStarts:config.ticketSaleStarts });
});

router.get('/partners', function (req,res) {
  res.render('partners/index',{title:'Partners |'});
});

router.get('/partners/:partner', function (req, res) {
  res.render('partners/'+ req.params.partner, {title: 'Partners - ' + req.params.partner + ' |', path: '/partners'});
});

router.get('/profile', auth, function (req, res) {
  User.findOne({email:req.session.passport.user}, function (err,user) {
    if (!err && user)
    {
      // Don't try to unescape here, it's not stored in user.
      // Do it in the template
      res.render('profile', {isbus_quickhack: config.verenigingen[user.vereniging].bus, providePreferences: config.providePreferences, speakerids: config.speakerids, speakers: config.speakers, matchingterms:config.matchingterms});
    }
    else
    {
      req.flash('error', 'Something went wrong, very horribly. Contact the committee asap.');
      res.redirect('/profile');
    }
  });
});

/**
 * This function is used to determine if there is still room for someone to 
 * enroll and takes in to account if someone is already enrolled. 
 */
async function canEnrollForLezing(lezingslot, lezingid, useremail){
  if(typeof lezingid == "undefined" || lezingid == "" || lezingid == null){
    return true;
  };

  lezing = config.speakers.filter(function(speaker){
    return speaker.id == lezingid;
  })

  // Lezing not found
  if (lezing.length != 1) {
    return false;
  }

  lezing = lezing[0];

  // Check if there is a limit and if so, if it has been reached
  if (lezing.limit) {
    var query = {};
    query[lezingslot] = lezingid;
    var result;

    await User
      .find(query)
      .where('email')
      .ne(useremail)
      .count()
      .then(function(res){
        result = res;
      });
      return result < lezing.limit;
  }

  return true;
}

router.post('/profile', auth, function (req, res) {
  req.sanitize('vegetarian').toBoolean();
  req.sanitize('bus').toBoolean();
  req.sanitize('shareEmail').toBoolean();
  req.body.linkedin = encodeURIComponent(req.body.linkedin);
  req.body.phonenumber = encodeURIComponent(req.body.phonenumber);

  if(typeof req.body.lezing1 === 'undefined'){
    req.body.lezing1 = '';
  }

  if(typeof req.body.lezing2 === 'undefined'){
    req.body.lezing2 = '';
  }

  if(typeof req.body.lezing3 == 'undefined'){
    req.body.lezing3 = '';
  }

  console.log(req.body.lezing2);

  if(req.body.lezing1 !== "" && req.body.lezing1 !== null && !config.speakerids.session1.includes(req.body.lezing1)){
    req.flash('error', "Lezing1 went wrong!");
    return res.redirect('/profile');
  }
  if(req.body.lezing2 !== "" && req.body.lezing2 !== null && !config.speakerids.session2.includes(req.body.lezing2)){
    req.flash('error', "Lezing2 went wrong!");
    return res.redirect('/profile');
  }
  if(req.body.lezing3 !== "" && req.body.lezing3 !== null && !config.speakerids.session3.includes(req.body.lezing3)){
    req.flash('error', "Lezing3 went wrong!");
    return res.redirect('/profile');
  }

  User.findOne({email:req.session.passport.user}).exec( async function (err, user) {
  if (!err){
/*******************************************************************************
 * There is some form of race condition possible. the check if the session is 
 * full can be done after someone else has been checked but before he has been
 * enrolled.
 *
 * Best would be to do a conditional update, however, Mongo does not support 
 * this feature in mongo 3.4.
 * 
 * For now this is not as big as a problem because one person extra is not 
 * that big of a problem. However, watch carefully if people actively abuse 
 * this
 ******************************************************************************/

      canEnrollSession1 = await canEnrollForLezing("lezing1", req.body.lezing1, req.session.passport.user);
      canEnrollSession2 = await canEnrollForLezing("lezing2", req.body.lezing2, req.session.passport.user);
      canEnrollSession3 = await canEnrollForLezing("lezing3", req.body.lezing3, req.session.passport.user);
      
      // naar functie zetten en samenvoegen
      if( canEnrollSession1 ){
        user.lezing1 = req.body.lezing1;
      } else {
        req.flash('error', "It is not possible to signup the talk you choice for the first session. It's possible it's full.");
        err = true;
      }

      if( canEnrollSession2 ){
        user.lezing2 = req.body.lezing2;
      } else {
        req.flash('error', "It is not possible to signup the talk you choice for the second session. It's possible it's full.");
        err = true;
      }

      if (canEnrollSession3){
        user.lezing3 = req.body.lezing3;
      } else {
        req.flash('error', "It is not possible to signup the talk you choice for the third session. It's possible it's full.");
        err = true;
      }

      user.vegetarian   = req.body.vegetarian ? true : false;
      user.bus          = req.body.bus ? true : false;
      user.specialNeeds = req.body.specialNeeds;
      user.phonenumber  = req.body.phonenumber;
      user.linkedin     = req.body.linkedin;
      user.shareEmail   = req.body.shareEmail; 
      var matching = [];
      for (var i = 0; i < config.matchingterms.length; i++) {
        if (req.body[config.matchingterms[i]]){
          matching.push(config.matchingterms[i]);
        }
      }
      user.matchingterms = matching;
      user.save();

      if(!err){
        req.flash('success', 'Profile edited');
      }
      res.redirect('/profile');
    } else {
      debug(err);
      console.log(err);
      req.flash('error', 'Something went wrong!');
      res.redirect('/profile');
    }
  })
});

router.get('/location', function (req, res) {
  res.render('location', {title: 'Location |'});
});
/*
 * Still needs its proper replacement, will come when bus times are available
 * Maybe include in the location or timetable page aswell.
 */
// router.get('/busses', function (req, res) {
//   res.render('busses', {title: 'Bussen'});
// });

router.get('/speakers', function (req, res) {
  var s = config.speakers.filter(function(speaker){
    return !speaker.hidden;
  });
  var p = config.presenters.filter(function(presenter){
    return !presenter.hidden;
  });
  res.render('speakers/index', {title: 'Speakers | ', speakers: s, presenters: p, speakerids: config.speakerids});
});

/*
 * TODO: Needs to be recreated
 */
// router.get('/speakers/:talk', function (req, res) {
//   var s = config.speakers.filter(function(speaker){
//     return (speaker.talk.replace(/\s/g, '-').replace('?', '').replace(':', '').replace('!', '').toLowerCase() === req.params.talk);
//   })[0];

//   if(!Boolean(s)){
//     res.render('error', {message: 'Not found', error: {status: 404}});
//     return;
//   }

//   res.render('speakers/talk', {path: '/speakers', speaker: s});
// });

router.get('/organisation', function (req, res) {
  res.render('organisation', {title: 'Organisation |'});
});

router.get('/connectbetter', function(req, res) {
  res.render('connectbetter', {title: 'Connect better |'})
});

router.get('/mailing', function (req,res) {
  res.render('mailing');
});

router.get('/participate', function (req, res) {
  res.render('participate');
});

router.get('/programme', function (req,res) {
  res.render('programme', {title:'Programme |'});
});

router.get('/program', function (req,res) {
  res.render('programme', {title:'Programme |'});
});
router.get('/schedule', function (req,res) {
  res.render('programme', {title:'Programme |'});
});
router.get('/dagprogramma', function (req,res) {
  res.render('programme', {title:'Programme |'});
});
router.get('/programma', function (req,res) {
  res.render('programme', {title:'Programme |'});
});

router.get('/users', adminAuth, function (req,res,next) {
  var query = {};

  if (req.query.email) {
    query.email = { $regex: new RegExp(req.query.email, 'i') };
  }
  if (req.query.firstname) {
    query.firstname = { $regex: new RegExp(req.query.firstname, 'i') };
  }
  if (req.query.surname) {
    query.surname = { $regex: new RegExp(req.query.surname, 'i') };
  }
  if (req.query.vereniging) {
    query.vereniging = { $regex: new RegExp(req.query.vereniging, 'i') };
  }
  if (req.query.ticket) {
    query.ticket = { $regex: new RegExp(req.query.ticket, 'i') };
  }
  if (req.query.aanwezig) {
    query.aanwezig = { $regex: new RegExp(req.query.aanwezig, 'i') };
  }

  User.find(query).sort({'vereniging':1,'firstname':1}).exec( function (err, results) {
    if (err) { return next(err); }
    //res.json(results);
    res.render('users',{users:results, verenigingen:config.verenigingen});
  });
});

/**
 * Output all dietary wishes provided by users
 */
router.get('/diet', adminAuth, function (req, res, next) {
  User.find({$or: [{'specialNeeds': {$ne: ""}}, {'vegetarian': true}]}).sort({'vereniging':1,'firstname':1}).exec( function (err, results) {
    if (err) { return next(err); }
    res.render('diet',{users:results, verenigingen:config.verenigingen});
  });
});

router.get('/users/:id', adminAuth, function (req,res,next) {
  User.findOne({_id:req.params.id}, function (err, result) {
    if (err) { return next(err); }
    res.render('users/edit', {user:result});
  });
});

router.post('/users/:id', adminAuth, function (req,res,next) {
  User.findOne({_id:req.params.id}, function (err, result) {
    if (err) { return next(err); }
    result.aanwezig = req.body.aanwezig;
    result.save(function(err) {
      if (err) {return next(err); }

      req.flash('success', "User edited!");
      return res.redirect('/users/'+req.params.id);
    });
  });
});

router.post('/aanmelden', adminAuth, function (req,res,next) {
  var ticket = req.body.ticket;
  User.findOne({ticket:ticket}, function (err, result) {
    if (err) {
      req.flash('error', "Something went wrong. Please contact the committee.");
      return res.redirect('/users');
    }

    if (!result) {
      req.flash('error', "Ticket not found. Try finding it manually" );
      return res.redirect('/users');
    }
    if (result.aanwezig) {
      req.flash('error', "That ticket was already used");
      return res.redirect('/users');
    }
    result.aanwezig = true;
    result.save(function (err) {
      if (err) { req.flash('error', "Something went wrong. Please contact the committee."); return res.redirect('/users'); }
      req.flash('success', res.locals.ucfirst(result.firstname) + ' ' + result.surname +' ('+ res.locals.verenigingen[result.vereniging].name +') has registered his ticket');
      res.redirect('/users');
    });
  });
});
var barc = new Barc({
  hri: false
});

/**
 * List of people present, per association
 */
router.get('/aanwezig', adminAuth, function (req,res,next) {
  var namen = _.keys(config.verenigingen);

  var findTickets = function (naam,cb) {
    User.find({vereniging:naam},{firstname:1,surname:1,email:1,bus:1,aanwezig:1},function(err, results) {
      if (err) { return cb(err); }

      cb(null, {name:naam, rows:results});
    });
  };
  async.map(namen, findTickets, function (err, result) {
    if (err) { return next(err); }
    res.render('aanwezig', { tables : result });
  });
});

/*******************************************************************************
 * Triggered if someone requests this page. This will be printed on the badge of
 * an attendee in the form of a QR code. Can be scanned with generic QR code
 * scanners. When url has been gotten, will be opened in browser.
 * 
 * Will create a list of all people to connected with during the event. After
 * the event, this can be used to send an email to everyone who participated
 * to exchange contact details.
 ******************************************************************************/
router.get('/connect/:id', auth, function(req, res, next){
  User.findOne({ticket: req.params.id}, function(err, user){
    if (err || !user) { 
      debug(err);
      res.render('connect', {connected: false, error: 'Ticket id is not valid'});
    } else {
      User.findOneAndUpdate({email:req.session.passport.user}, {$addToSet: {connectlist: req.params.id}},function(err, doc){
        if(err){
          res.render('connect', {connected: false, error: 'Could not update your connections'});
          console.log(req.params.id + "could not be added to the connectlist!");
        } else {
          res.render('connect', {connected: true, connectee: user});
        }
      });
    }
  })
});

/**
 * Session choices displayed for administrators
 */
router.get('/choices', adminAuth, function (req,res,next) {
  var opts = {reduce: function(a,b){ b.total++;}, initial: {total: 0}};

  User.aggregate([{ $group: { _id: '$lezing1', count: {$sum: 1} }}], function (err, lezing1) {
    User.aggregate([{ $group: { _id: '$lezing2', count: {$sum: 1} }}], function (err, lezing2) {
      User.aggregate([{ $group: { _id: '$lezing3', count: {$sum: 1} }}], function (err, lezing3) {
        res.render('choices', { lezing1 : lezing1, lezing2 : lezing2, lezing3 : lezing3  });
      });
    });
  });
});

router.get('/ticket', auth, function(req, res, next){
  User.findOne({email: req.session.passport.user}, function(err, doc) {
    res.redirect('/tickets/' + doc.ticket);
  });
});

// Old system of displaying tickets. Not used nowadays
router.get('/tickets/:id', function (req, res, next) {
  Ticket.findById(req.params.id).populate('ownedBy').exec(function (err, ticket) {
    if (err) { err.code = 403; return next(err); }
    if (!ticket || !ticket.ownedBy || ticket.ownedBy.email !== req.session.passport.user) {
      var error = new Error("Forbidden");
      error.code = 403;
      return next(error);
    }
    res.render('tickets/ticket', {ticket: ticket});
  });
});

router.get('/tickets/:id/barcode', function (req, res) {
  res.set('Content-Type', 'image/png');
  res.send(barc.code128(req.params.id, 440, 50));
});

 return router;
};
