export function advanceTurtle(trip, progress) {
 const p=Math.min(1,Math.max(0,Number.isFinite(progress)?progress:0));
 // Turning changes the pose, while the turtle always marks task progress.
 return {...trip,position:p,progress:p};
}
