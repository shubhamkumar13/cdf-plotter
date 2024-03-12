open Riot

module Test = struct
  type Telemetry.event += Boot

  let start () =
    Telemetry.attach (fun ev ->
        match ev with
        | Boot ->
            Logger.info (fun f -> f "telemetry_test: telemetry received");

            shutdown ()
        | _ -> ());

    let pid =
      spawn (fun () ->
          Telemetry.emit Boot;
          sleep 100.0)
    in
    Ok pid
end

let () =
  Riot.start
    ~apps:[ (module Riot.Telemetry); (module Riot.Logger); (module Test) ]
    ()
