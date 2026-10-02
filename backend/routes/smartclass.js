import express from "express";



import SmartClassData from "../models/SmartClassData.js";

import SmartClassSession from "../models/SmartClassSession.js";



import { auth } from "../middleware/auth.js";





const router = express.Router();





// ============================================================

// MIDDLEWARE CLÉ API

// ============================================================

//

// Utilisé par les machines :

// - camera_real.py

// - camera_sim.py

// - Raspberry Pi

//

// Le header attendu est :

//

// x-api-key: <SMARTCLASS_API_KEY>

//

// ============================================================



const requireApiKey = (req, res, next) => {



  const apiKey = req.headers["x-api-key"];



  if (

    apiKey &&

    process.env.SMARTCLASS_API_KEY &&

    apiKey === process.env.SMARTCLASS_API_KEY

  ) {

    return next();

  }



  return res.status(401).json({

    success: false,

    message: "Accès non autorisé (clé API invalide)",

  });

};





// ============================================================

// POST /api/smartclass/session/start

// NOUVEL ENDPOINT

// ============================================================

//

// Compatible avec :

// start_session.py

//

// Le professeur doit être connecté avec JWT.

//

// ============================================================



router.post("/session/start", auth, async (req, res) => {



  try {



    const teacherId = req.user?.id;



    const {

      courseId,

      room,

      roomId,

      sessionType,

    } = req.body;





    // Vérification utilisateur



    if (!teacherId) {



      return res.status(401).json({

        success: false,

        message: "Utilisateur non connecté",

      });



    }





    // Vérification courseId



    if (!courseId) {



      return res.status(400).json({

        success: false,

        message: "courseId obligatoire",

      });



    }





    // --------------------------------------------------------

    // Chercher une session déjà active

    // --------------------------------------------------------



    const existingSession =

      await SmartClassSession.findOne({



        teacher: teacherId,

        course: courseId,

        status: "active",



      });





    if (existingSession) {



      return res.status(409).json({



        success: false,



        message:

          "Une session SmartClass est déjà active pour ce cours",



        sessionId: existingSession._id,



      });



    }





    // --------------------------------------------------------

    // Créer la session

    // --------------------------------------------------------



    const session =

      await SmartClassSession.create({



        teacher: teacherId,



        course: courseId,



        // Compatible ancien + nouveau système

        roomId:

          roomId ||

          room ||

          "Salle A",



        status: "active",



      });





    console.log(

      `🎓 Session SmartClass créée : ${session._id}`

    );





    // start_session.py attend directement un objet

    // contenant "_id"



    return res.status(201).json(session);



  }



  catch (err) {



    console.error(

      "❌ Erreur création session SmartClass :",

      err

    );





    return res.status(500).json({



      success: false,



      message:

        "Erreur serveur lors de la création de la session",



      error: err.message,



    });



  }



});





// ============================================================

// ANCIEN ENDPOINT

// POST /api/smartclass/sessions/start

// ============================================================

//

// Conservé temporairement pour éviter de casser

// l'ancien dashboard.

//

// ============================================================



router.post("/sessions/start", auth, async (req, res) => {



  try {



    const {

      courseId,

      roomId,

    } = req.body;



    const teacherId =

      req.user?.id;





    if (!teacherId) {



      return res.status(401).json({



        success: false,



        message:

          "Utilisateur non connecté",



      });



    }





    if (!courseId) {



      return res.status(400).json({



        success: false,



        message:

          "courseId obligatoire",



      });



    }





    const existingActiveSession =

      await SmartClassSession.findOne({



        teacher: teacherId,



        course: courseId,



        status: "active",



      });





    if (existingActiveSession) {



      return res.status(400).json({



        success: false,



        message:

          "Une session est déjà active pour ce cours",



      });



    }





    const session =

      await SmartClassSession.create({



        teacher: teacherId,



        course: courseId,



        roomId:

          roomId ||

          "classA",



        status:

          "active",



      });





    return res.status(201).json({



      success: true,



      session,



    });



  }



  catch (err) {



    console.error(

      "Erreur lors de la création de la session :",

      err

    );





    return res.status(500).json({



      success: false,



      message:

        "Erreur serveur",



      error:

        err.message,



    });



  }



});





// ============================================================

// POST /api/smartclass/sessions/:sessionId/stop

// ============================================================



router.post(

  "/sessions/:sessionId/stop",

  auth,

  async (req, res) => {



    try {



      const {

        sessionId,

      } = req.params;



      const teacherId =

        req.user?.id;





      const session =

        await SmartClassSession.findById(

          sessionId

        );





      if (!session) {



        return res.status(404).json({



          success: false,



          message:

            "Session non trouvée",



        });



      }





      if (

        String(session.teacher) !==

        String(teacherId)

      ) {



        return res.status(403).json({



          success: false,



          message:

            "Vous n'êtes pas le propriétaire de cette session",



        });



      }





      session.status =

        "stopped";



      session.endedAt =

        new Date();





      await session.save();





      return res.json({



        success: true,



        session,



      });



    }



    catch (err) {



      console.error(

        "Erreur lors de l'arrêt de la session :",

        err

      );





      return res.status(500).json({



        success: false,



        message:

          "Erreur serveur",



      });



    }



  }

);





// ============================================================

// GET /api/smartclass/sessions/teacher

// ============================================================



router.get(

  "/sessions/teacher",

  auth,

  async (req, res) => {



    try {



      const teacherId =

        req.user?.id;





      if (!teacherId) {



        return res.status(401).json({



          success: false,



          message:

            "Utilisateur non connecté",



        });



      }





      const sessions =

        await SmartClassSession

          .find({

            teacher: teacherId,

          })

          .populate("course")

          .sort({

            startedAt: -1,

          });





      return res.json({



        success: true,



        sessions,



      });



    }



    catch (err) {



      console.error(

        "Erreur récupération sessions :",

        err

      );





      return res.status(500).json({



        success: false,



        message:

          "Erreur serveur",



      });



    }



  }

);





// ============================================================

// GET /api/smartclass/sessions/:sessionId/data

// ============================================================



router.get(

  "/sessions/:sessionId/data",

  async (req, res) => {



    try {



      const {

        sessionId,

      } = req.params;





      const data =

        await SmartClassData

          .find({

            sessionId,

          })

          .sort({

            recordedAt: 1,

          });





      return res.json({



        success: true,



        data,



      });



    }



    catch (err) {



      console.error(

        "Erreur récupération données SmartClass :",

        err

      );





      return res.status(500).json({



        success: false,



        message:

          "Erreur serveur",



      });



    }



  }

);





// ============================================================

// POST /api/smartclass/camera

// ============================================================

//

// Endpoint principal du NOUVEAU pipeline IA.

//

// Reçoit les données de :

//

// camera_real.py

// camera_sim.py

//

// ============================================================



router.post(

  "/camera",

  requireApiKey,

  async (req, res) => {



    try {



      const data =

        req.body;





      console.log(

        "\n📸 Données SmartClass reçues :",

        data

      );





      // ------------------------------------------------------

      // sessionId obligatoire

      // ------------------------------------------------------



      if (!data.sessionId) {



        return res.status(400).json({



          success: false,



          message:

            "sessionId obligatoire",



        });



      }





      // ------------------------------------------------------

      // Vérifier la session

      // ------------------------------------------------------



      const session =

        await SmartClassSession.findById(

          data.sessionId

        );





      if (!session) {



        return res.status(404).json({



          success: false,



          message:

            "Session SmartClass introuvable",



        });



      }





      if (

        session.status !==

        "active"

      ) {



        return res.status(409).json({



          success: false,



          message:

            "Cette session SmartClass n'est plus active",



        });



      }





      // ------------------------------------------------------

      // Actions YOLO

      // ------------------------------------------------------



      const actions =

        data.actions || {};





      // ------------------------------------------------------

      // Création du snapshot MongoDB

      // ------------------------------------------------------



      const smartClassData =

        await SmartClassData.create({



          // Données récupérées depuis la session

          sessionId:

            session._id,



          teacher:

            session.teacher,



          course:

            session.course,



          roomId:

            session.roomId,





          // Métriques principales

          attentionPct:

            data.attentionPct ?? 0,



          distractionPct:

            data.distractionPct ?? 0,



          fatiguePct:

            data.fatiguePct ?? 0,





          // Nouveau pipeline

          peopleCount:

            data.peopleCount ?? 0,



          actions:

            actions,



          avgConfidence:

            data.avgConfidence ?? 0,



          source:

            data.source || "unknown",





          // Timestamp caméra

          capturedAt:

            data.timestamp

              ? new Date(data.timestamp)

              : new Date(),





          // --------------------------------------------------

          // Compatibilité ancien dashboard

          // --------------------------------------------------



          detectedCount:

            data.peopleCount ?? 0,



          handsRaisedCount:

            actions.hand_raising ?? 0,





          recordedAt:

            new Date(),



        });





      console.log(

        `✅ SmartClass enregistré | session=${session._id} | personnes=${smartClassData.peopleCount}`

      );





      // ------------------------------------------------------

      // SOCKET.IO

      // ------------------------------------------------------



      if (req.io) {



        // Dashboard administrateur



        req.io

          .to("admin_dashboard")

          .emit(

            "smartclass:new_data",

            smartClassData

          );





        // Dashboard enseignant



        if (session.teacher) {



          req.io

            .to(

              String(session.teacher)

            )

            .emit(

              "smartclass:new_data",

              smartClassData

            );



        }





        // Salle virtuelle



        if (session.roomId) {



          req.io

            .to(

              `class:${session.roomId}`

            )

            .emit(

              "smartclass:update",

              smartClassData

            );



        }



      }





      return res.status(201).json({



        success: true,



        message:

          "Données SmartClass reçues et enregistrées",



        data:

          smartClassData,



      });



    }



    catch (err) {



      console.error(

        "❌ Erreur SmartClass camera :",

        err

      );





      return res.status(500).json({



        success: false,



        message:

          "Erreur serveur",



        error:

          err.message,



      });



    }



  }

);





// ============================================================

// GET /api/smartclass/sessions

// ============================================================

//

// Endpoint legacy.

// Récupère la dernière donnée connue par salle.

//

// ============================================================



router.get(

  "/sessions",

  async (req, res) => {



    try {



      const rooms =

        await SmartClassData.aggregate([



          {

            $sort: {

              recordedAt: -1,

            },

          },



          {

            $group: {



              _id:

                "$roomId",



              lastData: {

                $first:

                  "$$ROOT",

              },



            },

          },



        ]);





      const sessions =

        rooms.map(

          (room) => ({



            roomId:

              room._id,



            lastData:

              room.lastData,



            status:

              "active",



          })

        );





      return res.json({



        success: true,



        sessions,



      });



    }



    catch (err) {



      console.error(

        "Erreur récupération sessions :",

        err

      );





      return res.status(500).json({



        success: false,



        message:

          "Erreur serveur",



      });



    }



  }

);





// ============================================================

// GET /api/smartclass/room/:roomId

// ============================================================



router.get(

  "/room/:roomId",

  async (req, res) => {



    try {



      const {

        roomId,

      } = req.params;





      const {

        hours = 24,

        limit = 100,

      } = req.query;





      const since =

        new Date(

          Date.now() -

          Number(hours) *

          3600000

        );





      const data =

        await SmartClassData

          .find({



            roomId,



            recordedAt: {

              $gte: since,

            },



          })

          .sort({

            recordedAt: -1,

          })

          .limit(

            Number(limit)

          );





      return res.json({



        success: true,



        roomId,



        count:

          data.length,



        data:

          data.reverse(),



      });



    }



    catch (err) {



      console.error(

        "Erreur récupération données salle :",

        err

      );





      return res.status(500).json({



        success: false,



        message:

          "Erreur serveur",



      });



    }



  }

);





// ============================================================

// GET /api/smartclass/room/:roomId/latest

// ============================================================



router.get(

  "/room/:roomId/latest",

  async (req, res) => {



    try {



      const {

        roomId,

      } = req.params;





      const latestData =

        await SmartClassData

          .findOne({

            roomId,

          })

          .sort({

            recordedAt: -1,

          });





      if (!latestData) {



        return res.json({



          success: true,



          data: null,



          message:

            "Aucune donnée pour cette salle",



        });



      }





      return res.json({



        success: true,



        data:

          latestData,



      });



    }



    catch (err) {



      console.error(

        "Erreur récupération dernières données :",

        err

      );





      return res.status(500).json({



        success: false,



        message:

          "Erreur serveur",



      });



    }



  }

);





export default router;