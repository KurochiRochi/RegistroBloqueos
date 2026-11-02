import {reportPdf} from '../src/reports.ts';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {parsePatientHtml} from '../src/patient-parser.ts';
const base={Codigo_Bloqueo:'000123',Establecimiento:'Arrau Méndez',Sector:'Sector de prueba',Profesional:'Profesional ficticio',Profesion:'Tecnólogo/a médico/a',Agendas:['Agenda A','Agenda B'],Agenda:'Agenda A',Tipo_Bloqueo:'LICENCIA MEDICA',Fecha_Inicio:'2026-10-26',Fecha_Termino:'2026-10-30',Tipo_Horario:'MEDIA JORNADA',Media_Jornada:'AM',Hora_Inicio:'',Hora_Termino:'',Dias_Bloqueo:5,Pacientes_Citados:false,Observacion:'Datos sintéticos para validación visual.',archived:0};
const rows=Array.from({length:18},(_,i)=>({...base,id:String(i),Codigo_Bloqueo:String(123+i).padStart(6,'0'),Profesional:'Profesional ficticio '+i,Establecimiento:i%2?'Buenos Aires':'Arrau Méndez'}));
mkdirSync('outputs',{recursive:true});
reportPdf(rows,'2026-10-26','2026-10-30',{years:[{year:2026,reviewed:true,source:'Prueba'}],holidays:[]}).save('outputs/informe-prueba.pdf');
const cells=['11111111-1','Persona ficticia','Comuna de prueba','000000000','Dirección ficticia','Agenda A','30/10/2026 08:00','NUEVO','1','','usuario','Usuario ficticio','Sin datos reales'];
writeFileSync('outputs/nomina-prueba.html','<html><head><meta charset="utf-8"></head><body><table><tr>'+cells.map(c=>`<td>${c}</td>`).join('')+'</tr></table></body></html>');
const input=process.argv[2];if(input){const actual=new TextDecoder('windows-1252').decode(readFileSync(input));const parsed=parsePatientHtml(actual);if(!parsed.length||parsed.some(r=>r.length!==13))throw new Error('No se reconoció el ejemplo');console.log(`Ejemplo local: ${parsed.length} filas de 13 columnas reconocidas. No se copiaron ni cargaron datos del ejemplo.`);}
